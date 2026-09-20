import { describe, expect, it, vi } from "vitest";
import { ExportRunner } from "@/export/ExportRunner";
import { buildExportPlan } from "@/export/ExportPlan";
import { QueryBlockRenderer } from "@/export/QueryBlockResolver";
import { DEFAULT_SETTINGS } from "@/types";
import { createMemoryVault } from "@/test-support/memory-vault";

const settings = { ...DEFAULT_SETTINGS, expandEmbeds: true, overwriteExisting: true };

function planFor(fixture: ReturnType<typeof createMemoryVault>, path: string) {
	return buildExportPlan({
		source: { type: "current-file", path },
		inputFiles: [path],
		outputRoot: "exports",
		outputFilename: "Note",
	});
}

describe("markdown export", () => {
	const source = "# Note\n\nIntro\n\n```tasks\nnot done\n```\n\nOutro\n";

	it("writes a .md file with query results instead of query source", async () => {
		const fixture = createMemoryVault();
		fixture.putText("Note.md", source);
		const queryRenderer: QueryBlockRenderer = vi.fn(async () => ({
			ok: true as const, markdown: "- [ ] Buy milk",
		}));

		const result = await new ExportRunner(fixture.app).run(
			planFor(fixture, "Note.md"), settings, undefined, { queryRenderer },
		);

		expect(result.status).toBe("completed");
		expect(queryRenderer).toHaveBeenCalledWith("```tasks\nnot done\n```", "Note.md", "tasks");
		const out = fixture.text("exports/Note.md");
		expect(out).toContain("- [ ] Buy milk");
		expect(out).not.toContain("```tasks");
		expect(out).toContain("Intro");
	});

	it("adds a source path comment under the title only when the setting is on", async () => {
		const fixture = createMemoryVault();
		fixture.putText("Note.md", "# Note\n\nHello\n");
		const queryRenderer: QueryBlockRenderer = vi.fn();

		await new ExportRunner(fixture.app).run(
			planFor(fixture, "Note.md"),
			{ ...settings, includeSourcePathComments: true },
			undefined, { queryRenderer },
		);
		expect(fixture.text("exports/Note.md")).toBe("# Note\n\n<!-- source: Note.md -->\nHello\n\n");

		await new ExportRunner(fixture.app).run(
			planFor(fixture, "Note.md"),
			{ ...settings, includeSourcePathComments: false },
			undefined, { queryRenderer },
		);
		expect(fixture.text("exports/Note.md")).toBe("# Note\n\nHello\n\n");
	});

	it("keeps the query source and reports a warning when a block cannot be rendered", async () => {
		const fixture = createMemoryVault();
		fixture.putText("Note.md", source);
		const queryRenderer: QueryBlockRenderer = async () => ({ ok: false as const, reason: "no plugin" });

		const result = await new ExportRunner(fixture.app).run(
			planFor(fixture, "Note.md"), settings, undefined, { queryRenderer },
		);

		expect(result.status).toBe("completed");
		expect(fixture.text("exports/Note.md")).toContain("```tasks\nnot done\n```");
		expect(result.warnings).toEqual([expect.stringContaining("no plugin")]);
	});

	it("runs results through link rewriting like the rest of the note", async () => {
		const fixture = createMemoryVault();
		fixture.putText("Note.md", source);
		const queryRenderer: QueryBlockRenderer = async () => ({ ok: true as const, markdown: "- [[Missing note]]" });

		await new ExportRunner(fixture.app).run(
			planFor(fixture, "Note.md"), settings, undefined, { queryRenderer },
		);

		expect(fixture.text("exports/Note.md")).not.toContain("[[Missing note]]");
	});

	it("uses vault paths for links to notes outside the export", async () => {
		const fixture = createMemoryVault();
		fixture.putText("Note.md", `${source}\nSee [[Folder/Other|Other]].\n`);
		fixture.putText("Folder/Other.md", "# Other");
		const queryRenderer: QueryBlockRenderer = async () => ({
			ok: true as const,
			markdown: "| File |\n| --- |\n| [[Folder/Other\\|Other]] |",
		});

		const result = await new ExportRunner(fixture.app).run(
			planFor(fixture, "Note.md"), settings, undefined, { queryRenderer },
		);

		const out = fixture.text("exports/Note.md");
		const link = "Folder/Other.md";
		expect(out).toContain(`| [Other](${link}) |`);
		expect(out).toContain(`See [Other](${link}).`);
		expect(result.warnings).toEqual([]);
	});

	describe("properties", () => {
		const withProperties = `---\nтип: daily\nссылки:\n  - "[[2026-W38]]"\n---\n${source}`;

		async function exportNote(includeProperties: boolean, note = withProperties) {
			const fixture = createMemoryVault();
			fixture.putText("Note.md", note);
			const queryRenderer: QueryBlockRenderer = async () => ({ ok: true as const, markdown: "- [ ] Buy milk" });
			await new ExportRunner(fixture.app).run(
				planFor(fixture, "Note.md"),
				{ ...settings, includeProperties },
				undefined,
				{ queryRenderer },
			);
			return fixture.text("exports/Note.md");
		}

		it("keeps the original properties block at the top of the file", async () => {
			const out = await exportNote(true);
			expect(out.startsWith('---\nтип: daily\nссылки:\n  - "[[2026-W38]]"\n---\n\n# Note')).toBe(true);
			expect(out).toContain("- [ ] Buy milk");
		});

		it("omits the properties when the setting is off", async () => {
			const out = await exportNote(false);
			expect(out.startsWith("# Note")).toBe(true);
			expect(out).not.toContain("тип: daily");
		});

		it("keeps multi-line, nested and CRLF properties verbatim", async () => {
			const block = "---\r\ntitle: Daily\r\ntags:\r\n  - a\r\n  - b\r\nmeta:\r\n  nested: true\r\n---";
			const out = await exportNote(true, `${block}\r\n${source}`);
			expect(out.startsWith(`${block}\n\n# Daily`)).toBe(true);
			expect(out.match(/tags:/g)).toHaveLength(1);
		});

		it("does not repeat the properties in the body", async () => {
			const out = await exportNote(true);
			expect(out.match(/тип: daily/g)).toHaveLength(1);
		});

		it("skips an empty properties block", async () => {
			const out = await exportNote(true, `---\n---\n${source}`);
			expect(out.startsWith("# Note")).toBe(true);
			expect(out).not.toContain("---");
		});

		it("draws properties per note in a batch and only for notes that have them", async () => {
			const fixture = createMemoryVault();
			fixture.putText("folder/With.md", "---\nstatus: draft\n---\n# With\n\nBody with\n");
			fixture.putText("folder/Without.md", "# Without\n\nBody without\n");
			const plan = buildExportPlan({
				source: { type: "folder", path: "folder" },
				inputFiles: ["folder/With.md", "folder/Without.md"],
				outputRoot: "exports",
				outputFilename: "index",
				outputFolderName: "folder",
			});

			const result = await new ExportRunner(fixture.app).run(plan, settings);

			expect(result.status).toBe("completed");
			expect(fixture.text("exports/folder/With.md")).toBe(
				"---\nstatus: draft\n---\n\n# With\n\nBody with\n\n",
			);
			expect(fixture.text("exports/folder/Without.md").startsWith("# Without\n")).toBe(true);
			expect(fixture.text("exports/folder/Without.md")).not.toContain("---");
		});

		it("writes nothing extra for a note without properties", async () => {
			const fixture = createMemoryVault();
			fixture.putText("Note.md", source);
			await new ExportRunner(fixture.app).run(
				planFor(fixture, "Note.md"), settings, undefined,
				{ queryRenderer: async () => ({ ok: true as const, markdown: "x" }) },
			);
			expect(fixture.text("exports/Note.md").startsWith("# Note")).toBe(true);
		});
	});

	it("warns and keeps blocks when no DOM is available", async () => {
		const fixture = createMemoryVault();
		fixture.putText("Note.md", source);

		const result = await new ExportRunner(fixture.app).run(
			planFor(fixture, "Note.md"), settings,
		);

		expect(result.status).toBe("completed");
		expect(fixture.text("exports/Note.md")).toContain("```tasks\nnot done\n```");
		expect(result.warnings).toEqual([expect.stringContaining("no rendering environment")]);
	});
});
