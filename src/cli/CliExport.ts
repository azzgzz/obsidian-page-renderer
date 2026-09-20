import type { App, CliData, CliFlags } from "obsidian";
import { ExportSettings } from "@/types";
import { MemoryTarget } from "@/export/OutputTarget";
import { runExport } from "@/runExport";
import { exportResultMessage } from "@/ui/ExportResultMessage";

export const CLI_COMMAND = "page-md-renderer";
export const CLI_DESCRIPTION = "Export a note to Markdown with rendered query results (default: print to stdout)";

export const CLI_FLAGS: CliFlags = {
	file: {
		value: "<path>",
		description: "Markdown note: absolute path or path inside the vault",
		required: true,
	},
	printToFile: {
		value: "<true|false>",
		description: "Write files to the output folder instead of printing the Markdown to stdout (default: false)",
	},
	output: {
		value: "<folder>",
		description: "Output folder with printToFile=true (default: the plugin's output folder setting)",
	},
	overwrite: {
		value: "<true|false>",
		description: "Replace existing output with printToFile=true (default: true)",
	},
};

export type CliExportRequest = {
	file: string;
	outputFolder: string;
	overwrite: boolean;
	printToFile: boolean;
};

export type CliParseResult =
	| { ok: true; request: CliExportRequest }
	| { ok: false; error: string };

function isAbsolutePath(p: string): boolean {
	return p.startsWith("/") || /^[A-Za-z]:\//.test(p);
}

/**
 * Converts a CLI path to a vault-relative one. Absolute paths must lie inside
 * the vault base path; relative paths are treated as already vault-relative.
 * Returns null when the path cannot be mapped into the vault.
 */
export function toVaultPath(input: string, basePath: string | null): string | null {
	const normalized = input.trim().replace(/\\/g, "/");
	if (!normalized) return null;

	if (isAbsolutePath(normalized)) {
		if (!basePath) return null;
		const base = basePath.replace(/\\/g, "/").replace(/\/+$/, "");
		if (!normalized.startsWith(`${base}/`)) return null;
		return normalized.slice(base.length + 1);
	}

	const relative = normalized.replace(/^(\.\/)+/, "");
	if (relative.split("/").some((s) => s === "..")) return null;
	return relative;
}

export function parseCliExport(
	params: CliData,
	basePath: string | null,
	defaultOutputFolder: string,
): CliParseResult {
	const rawFile = params.file;
	if (!rawFile || rawFile === "true") {
		return { ok: false, error: "Missing required parameter: file" };
	}

	const file = toVaultPath(rawFile, basePath);
	if (file === null) {
		return { ok: false, error: `File is outside the vault: ${rawFile}` };
	}
	if (!file.toLowerCase().endsWith(".md")) {
		return { ok: false, error: `Not a Markdown note: ${rawFile}` };
	}

	const printToFile = params.printToFile?.trim().toLowerCase() === "true";

	const rawOutput = params.output?.trim().replace(/\\/g, "/").replace(/\/+$/, "");
	const outputFolder = rawOutput && rawOutput !== "true" ? rawOutput : defaultOutputFolder;

	const overwrite = params.overwrite?.trim().toLowerCase() !== "false";

	return { ok: true, request: { file, outputFolder, overwrite, printToFile } };
}

function getVaultBasePath(app: App): string | null {
	const adapter = app.vault.adapter as { getBasePath?: () => string };
	return typeof adapter.getBasePath === "function" ? adapter.getBasePath() : null;
}

export async function runCliExport(
	app: App,
	settings: ExportSettings,
	params: CliData,
): Promise<string> {
	try {
		const parsed = parseCliExport(params, getVaultBasePath(app), settings.defaultOutputFolder);
		if (!parsed.ok) return `Error: ${parsed.error}`;
		const { file, outputFolder, overwrite, printToFile } = parsed.request;

		// Without printToFile the document is rendered into memory, so `output` and
		// `overwrite` have nothing to act on.
		const writer = printToFile ? undefined : new MemoryTarget();
		const outcome = await runExport(
			app,
			{ ...settings, overwriteExisting: printToFile ? overwrite : true },
			{
				source: { type: "current-file", path: file },
				outputFolder,
				outputFilename: (file.split("/").pop() ?? file).replace(/\.md$/i, ""),
			},
			writer ? { writer } : {},
		);
		if (!outcome.ok) {
			return outcome.reason === "no-files"
				? `Error: Note not found in the vault: ${file}`
				: `Error: ${outcome.error}`;
		}

		const { result } = outcome;
		const message = exportResultMessage(result);
		if (result.status !== "completed") return `Error: ${message}`;
		if (!writer) return [message, ...result.completedPaths].join("\n");

		const content = writer.files.get(result.completedPaths[0]);
		return typeof content === "string" ? content : "Error: Nothing was rendered";
	} catch (err) {
		return `Error: ${err instanceof Error ? err.message : String(err)}`;
	}
}
