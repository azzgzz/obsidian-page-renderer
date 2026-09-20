import { describe, it, expect } from "vitest";
import {
	validatePlan,
	buildExportPlan,
	relocatePlan,
} from "@/export/ExportPlan";
import { ExportPlan, ExportSource } from "@/types";

function makePlan(overrides: Partial<ExportPlan> = {}): ExportPlan {
	return {
		source: { type: "current-file", path: "note.md" },
		inputFiles: ["note.md"],
		outputRoot: "exports",
		outputFilename: "document",
		outputFiles: ["exports/document.md"],
		attachmentCopies: [],
		...overrides,
	};
}

describe("validatePlan", () => {
	it("returns error for empty inputFiles", () => {
		const plan = makePlan({ inputFiles: [] });
		const result = validatePlan(plan);
		expect(result).toBe("No files to export. Check your source selection.");
	});

	it("returns error for empty outputRoot", () => {
		const plan = makePlan({ outputRoot: "" });
		const result = validatePlan(plan);
		expect(result).toBe("Output folder cannot be empty.");
	});

	it("returns error for whitespace-only outputRoot", () => {
		const plan = makePlan({ outputRoot: "   " });
		const result = validatePlan(plan);
		expect(result).toBe("Output folder cannot be empty.");
	});

	it("allows absolute outputRoot paths (external)", () => {
		const plan = makePlan({ outputRoot: "/absolute/path" });
		const result = validatePlan(plan);
		expect(result).toBeNull();
	});

	it("returns error for outputRoot starting with ..", () => {
		const plan = makePlan({ outputRoot: "../escape" });
		const result = validatePlan(plan);
		expect(result).toBe("Output folder cannot use parent directory traversal.");
	});

	it("returns error for .. embedded in middle of path", () => {
		const plan = makePlan({ outputRoot: "foo/../../../etc" });
		const result = validatePlan(plan);
		expect(result).toBe("Output folder cannot use parent directory traversal.");
	});

	it("returns error for single dot segment in path", () => {
		const plan = makePlan({ outputRoot: "foo/./bar" });
		const result = validatePlan(plan);
		expect(result).toBe("Output folder cannot use parent directory traversal.");
	});

	it("allows dots within folder names", () => {
		const plan = makePlan({ outputRoot: "my.exports/v1.0" });
		const result = validatePlan(plan);
		expect(result).toBeNull();
	});

	it("returns null for valid plan", () => {
		const plan = makePlan();
		const result = validatePlan(plan);
		expect(result).toBeNull();
	});

	it.each([
		"../outside",
		"nested/name",
		"nested\\name",
		".",
		"..",
		"bad:name",
		"bad\u0000name",
		"trailing.",
		"trailing ",
		"CON",
		"con.txt",
		"NUL",
		"COM1",
		"LPT9.log",
	])("rejects unsafe output filename %j", (outputFilename) => {
		const result = validatePlan(makePlan({ outputFilename }));
		expect(result).toMatch(/file name/i);
	});

	it.each(["../outside", "nested/name", "nested\\name", ".", ".."])(
		"rejects unsafe batch folder name %j",
		(outputFolderName) => {
			const result = validatePlan(makePlan({
				source: { type: "folder", path: "notes" },
				outputFolderName,
			}));
			expect(result).toMatch(/folder name/i);
		},
	);
});

describe("buildExportPlan", () => {
	const defaultSource: ExportSource = { type: "current-file", path: "note.md" };
	const single = (overrides: Partial<Parameters<typeof buildExportPlan>[0]> = {}) =>
		buildExportPlan({
			source: defaultSource,
			inputFiles: ["note.md"],
			outputRoot: "exports",
			outputFilename: "document",
			...overrides,
		});

	it("produces the .md output file for a single note", () => {
		expect(single().outputFiles).toEqual(["exports/document.md"]);
	});

	it("passes through all layout fields", () => {
		const plan = single({ inputFiles: ["a.md", "b.md"] });

		expect(plan.source).toBe(defaultSource);
		expect(plan.inputFiles).toEqual(["a.md", "b.md"]);
		expect(plan.outputRoot).toBe("exports");
		expect(plan.outputFilename).toBe("document");
		expect(plan.attachmentCopies).toEqual([]);
	});

	it("strips extension from custom filename", () => {
		expect(single({ outputFilename: "my-note.md" }).outputFiles).toEqual(["exports/my-note.md"]);
	});

	it("keeps a non-Markdown extension as part of the name", () => {
		expect(single({ outputFilename: "report.pdf" }).outputFiles).toEqual(["exports/report.pdf.md"]);
	});

	it("maps a batch to .md files that keep the folder structure", () => {
		const plan = buildExportPlan({
			source: { type: "folder", path: "notes" },
			inputFiles: ["notes/a.md", "notes/nested/b.md"],
			outputRoot: "exports",
			outputFilename: "index",
			outputFolderName: "notes",
		});

		expect(plan.outputFiles).toEqual(["exports/notes/a.md", "exports/notes/nested/b.md"]);
	});

	it("maps picked files relative to their common directory", () => {
		const plan = buildExportPlan({
			source: { type: "files", paths: ["a/x/1.md", "a/y/2.md"] },
			inputFiles: ["a/x/1.md", "a/y/2.md"],
			outputRoot: "exports",
			outputFilename: "index",
			outputFolderName: "picked",
		});

		expect(plan.outputFiles).toEqual(["exports/picked/x/1.md", "exports/picked/y/2.md"]);
	});
});

describe("relocatePlan", () => {
	it("recomputes a single output file from the new root", () => {
		const relocated = relocatePlan(makePlan(), "exports-2026-07-29");

		expect(relocated.outputRoot).toBe("exports-2026-07-29");
		expect(relocated.outputFiles).toEqual(["exports-2026-07-29/document.md"]);
	});

	it("recomputes batch output files from the new leaf folder", () => {
		const plan = makePlan({
			source: { type: "folder", path: "notes" },
			inputFiles: ["notes/a.md", "notes/nested/b.md"],
			outputFolderName: "notes",
			outputFiles: ["exports/notes/a.md", "exports/notes/nested/b.md"],
		});

		const relocated = relocatePlan(plan, "exports", "notes-2026-07-29");

		expect(relocated.outputFiles).toEqual([
			"exports/notes-2026-07-29/a.md",
			"exports/notes-2026-07-29/nested/b.md",
		]);
	});
});
