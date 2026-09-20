import type { ExportPlan } from "@/types";
import type { ExportStatus } from "@/export/ExportOutcome";
import type { OutputTarget } from "@/export/OutputTarget";

export interface ReportData {
	status: ExportStatus;
	totalFiles: number;
	completedPaths: string[];
	incompletePaths: string[];
	warnings: string[];
	errors: string[];
}

/**
 * Writes export-report.md into `root` and returns its path. The path avoids
 * every planned output and existing file, so a report never replaces content.
 */
export async function writeReport(
	target: OutputTarget,
	root: string,
	plan: ExportPlan,
	data: ReportData,
): Promise<string> {
	const path = reportPath(root, plan, target);
	await target.writeText(path, reportContent(data));
	return path;
}

export function reportContent(data: ReportData): string {
	const lines = [
		"# Export Report",
		"",
		`Status: ${data.status}`,
		`Files: ${data.completedPaths.length} of ${data.totalFiles} complete`,
	];
	if (data.completedPaths.length > 0) {
		lines.push("", "## Completed", ...data.completedPaths.map((p) => `- ${p}`));
	}
	if (data.incompletePaths.length > 0) {
		lines.push(
			"", "## Possibly incomplete",
			...data.incompletePaths.map((p) => `- ${p}`),
			"",
			"These outputs may exist but are not complete.",
		);
	}
	if (data.warnings.length > 0) {
		lines.push("", "## Warnings", ...numbered(data.warnings));
	}
	if (data.errors.length > 0) {
		lines.push("", "## Errors", ...numbered(data.errors));
	}
	return `${lines.join("\n")}\n`;
}

// Case-insensitive reservation is deliberately conservative for
// case-insensitive filesystems.
export function reportPath(
	root: string,
	plan: ExportPlan,
	target: Pick<OutputTarget, "pathExists">,
): string {
	const reserved = new Set(plan.outputFiles.map((path) => path.toLowerCase()));
	let sequence = 1;
	let candidate = `${root}/export-report.md`;
	const conflicts = (path: string) => {
		const key = path.toLowerCase();
		return target.pathExists(path) || [...reserved].some(
			(other) => other === key || other.startsWith(`${key}/`)
				|| key.startsWith(`${other}/`),
		);
	};
	while (conflicts(candidate)) {
		sequence++;
		candidate = `${root}/export-report-${sequence}.md`;
	}
	return candidate;
}

function numbered(items: string[]): string[] {
	return items.map((item, i) => `${i + 1}. ${item}`);
}
