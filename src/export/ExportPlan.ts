import { ExportPlan } from "@/types";
import type { OutputTarget } from "@/export/OutputTarget";
import { longestCommonDirPrefix, timestampSuffix, timestampedFolder } from "@/export/utils";

const INVALID_OUTPUT_NAME_RE = /[<>:"/\\|?*]/;
const WINDOWS_RESERVED_NAME_RE = /^(con|prn|aux|nul|com[1-9]|lpt[1-9])(?:\.|$)/i;

export function validateOutputLeafName(
	value: string,
	label: "File name" | "Folder name",
): string | null {
	const trimmed = value.trim();
	const hasControlCharacter = Array.from(trimmed)
		.some((character) => character.charCodeAt(0) <= 0x1F);
	if (!trimmed) return `${label} cannot be empty.`;
	if (
		trimmed !== value
		|| trimmed === "."
		|| trimmed === ".."
		|| trimmed.endsWith(".")
		|| INVALID_OUTPUT_NAME_RE.test(trimmed)
		|| hasControlCharacter
		|| WINDOWS_RESERVED_NAME_RE.test(trimmed)
	) {
		return `${label} contains invalid path characters.`;
	}
	return null;
}

type OutputLayout = Pick<
	ExportPlan,
	"source" | "inputFiles" | "outputRoot" | "outputFilename" | "outputFolderName"
>;

export function computeOutputFiles(layout: OutputLayout): string[] {
	if (layout.source.type === "current-file") {
		const baseName = layout.outputFilename.replace(/\.md$/i, "");
		return [`${layout.outputRoot}/${baseName}.md`];
	}

	const root = layout.outputFolderName
		? `${layout.outputRoot}/${layout.outputFolderName}`
		: layout.outputRoot;
	// Paths are exported relative to the source folder, or to the common
	// directory of the picked files.
	const prefix = layout.source.type === "folder"
		? (layout.source.path ? `${layout.source.path}/` : "")
		: longestCommonDirPrefix(layout.inputFiles);

	return layout.inputFiles.map((path) => {
		const relative = prefix && path.startsWith(prefix) ? path.slice(prefix.length) : path;
		return `${root}/${relative}`;
	});
}

export function relocatePlan(
	plan: ExportPlan,
	outputRoot: string,
	outputFolderName = plan.outputFolderName,
): ExportPlan {
	const relocated = { ...plan, outputRoot, outputFolderName };
	return { ...relocated, outputFiles: computeOutputFiles(relocated) };
}

export function buildExportPlan(layout: OutputLayout): ExportPlan {
	return {
		...layout,
		outputFiles: computeOutputFiles(layout),
		attachmentCopies: [],
	};
}

export function validatePlan(plan: ExportPlan): string | null {
	if (plan.inputFiles.length === 0) {
		return "No files to export. Check your source selection.";
	}
	if (!plan.outputRoot || plan.outputRoot.trim() === "") {
		return "Output folder cannot be empty.";
	}
	const segments = plan.outputRoot.split("/");
	if (segments.some(s => s === ".." || s === ".")) {
		return "Output folder cannot use parent directory traversal.";
	}
	const filenameError = validateOutputLeafName(plan.outputFilename, "File name");
	if (filenameError) return filenameError;

	if (plan.source.type !== "current-file" && plan.outputFolderName !== undefined) {
		const folderError = validateOutputLeafName(plan.outputFolderName, "Folder name");
		if (folderError) return folderError;
	}
	return null;
}

/**
 * With overwrite off, an export never touches earlier output: when the target
 * is already occupied the whole plan moves to a timestamped location.
 */
export function resolveEffectivePlan(
	plan: ExportPlan,
	overwriteExisting: boolean,
	target: Pick<OutputTarget, "pathExists">,
): ExportPlan {
	if (overwriteExisting) return plan;

	if (plan.source.type === "current-file") {
		// Reuse the single-file output root only if nothing occupies it;
		// an existing file or directory — even an empty one — relocates the
		// whole export so previous outputs keep their attachments.
		if (!target.pathExists(plan.outputRoot)) return plan;
		const candidateRoot = nextAvailablePath(timestampedFolder(plan.outputRoot), target);
		return relocatePlan(plan, candidateRoot);
	}

	const batchRoot = plan.outputFolderName
		? `${plan.outputRoot}/${plan.outputFolderName}`
		: plan.outputRoot;
	if (!target.pathExists(batchRoot)) return plan;

	const baseFolderName = `${plan.outputFolderName ?? "files"}-${timestampSuffix()}`;
	const availablePath = nextAvailablePath(`${plan.outputRoot}/${baseFolderName}`, target);
	const folderName = availablePath.slice(plan.outputRoot.length + 1);
	return relocatePlan(plan, plan.outputRoot, folderName);
}

function nextAvailablePath(candidate: string, target: Pick<OutputTarget, "pathExists">): string {
	if (!target.pathExists(candidate)) return candidate;

	let sequence = 2;
	let available = `${candidate}-${sequence}`;
	while (target.pathExists(available)) {
		sequence++;
		available = `${candidate}-${sequence}`;
	}
	return available;
}
