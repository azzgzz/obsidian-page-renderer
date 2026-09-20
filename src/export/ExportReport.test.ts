import { describe, expect, it } from "vitest";
import { reportContent, reportPath, writeReport } from "@/export/ExportReport";
import { MemoryTarget } from "@/export/OutputTarget";
import type { ExportPlan } from "@/types";

const plan: ExportPlan = {
	source: { type: "current-file", path: "note.md" },
	inputFiles: ["note.md"],
	outputRoot: "exports",
	outputFilename: "note",
	outputFiles: ["exports/note.md"],
	attachmentCopies: [],
};

describe("reportContent", () => {
	it("lists status, counts and every non-empty section", () => {
		const text = reportContent({
			status: "partial",
			totalFiles: 3,
			completedPaths: ["exports/a.md"],
			incompletePaths: ["exports/b.md"],
			warnings: ["w1", "w2"],
			errors: ["e1"],
		});

		expect(text).toBe([
			"# Export Report",
			"",
			"Status: partial",
			"Files: 1 of 3 complete",
			"",
			"## Completed",
			"- exports/a.md",
			"",
			"## Possibly incomplete",
			"- exports/b.md",
			"",
			"These outputs may exist but are not complete.",
			"",
			"## Warnings",
			"1. w1",
			"2. w2",
			"",
			"## Errors",
			"1. e1",
			"",
		].join("\n"));
	});

	it("omits empty sections", () => {
		const text = reportContent({
			status: "completed", totalFiles: 1, completedPaths: [], incompletePaths: [],
			warnings: ["only a warning"], errors: [],
		});
		expect(text).not.toContain("## Completed");
		expect(text).not.toContain("## Errors");
		expect(text).toContain("## Warnings");
	});
});

describe("reportPath", () => {
	it("uses the plain name when nothing conflicts", () => {
		expect(reportPath("exports", plan, new MemoryTarget())).toBe("exports/export-report.md");
	});

	it("skips existing paths and planned outputs, case-insensitively", () => {
		const existing = new Set(["exports/export-report.md"]);
		const taken = { pathExists: (p: string) => existing.has(p) };
		expect(reportPath("exports", plan, taken)).toBe("exports/export-report-2.md");

		const clashing = { ...plan, outputFiles: ["exports/Export-Report.md"] };
		expect(reportPath("exports", clashing, new MemoryTarget())).toBe("exports/export-report-2.md");
	});
});

describe("writeReport", () => {
	it("writes the report and returns its path", async () => {
		const target = new MemoryTarget();
		const path = await writeReport(target, "exports", plan, {
			status: "completed", totalFiles: 1, completedPaths: ["exports/note.md"],
			incompletePaths: [], warnings: ["w"], errors: [],
		});

		expect(path).toBe("exports/export-report.md");
		expect(target.files.get(path)).toContain("Status: completed");
	});
});
