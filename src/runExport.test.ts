import { describe, expect, it, vi } from "vitest";
import { runExport } from "@/runExport";
import { DEFAULT_SETTINGS } from "@/types";
import { MemoryTarget } from "@/export/OutputTarget";
import { createMemoryVault } from "@/test-support/memory-vault";

const settings = { ...DEFAULT_SETTINGS, overwriteExisting: true };
const queryRenderer = vi.fn();

describe("runExport", () => {
	it("resolves, plans and runs a single note", async () => {
		const fixture = createMemoryVault();
		fixture.putText("Note.md", "# Note\n\nBody\n");
		const writer = new MemoryTarget();

		const outcome = await runExport(fixture.app, settings, {
			source: { type: "current-file", path: "Note.md" },
			outputFolder: "out",
			outputFilename: "Note",
		}, { writer, queryRenderer });

		expect(outcome.ok && outcome.result.status).toBe("completed");
		expect(writer.files.get("out/Note.md")).toBe("# Note\n\nBody\n\n");
	});

	it("reports a missing source as no-files", async () => {
		const fixture = createMemoryVault();

		const outcome = await runExport(fixture.app, settings, {
			source: { type: "current-file", path: "Missing.md" },
			outputFolder: "out",
			outputFilename: "Missing",
		});

		expect(outcome).toMatchObject({ ok: false, reason: "no-files" });
	});

	it("reports an invalid plan without running", async () => {
		const fixture = createMemoryVault();
		fixture.putText("Note.md", "Body");

		const outcome = await runExport(fixture.app, settings, {
			source: { type: "current-file", path: "Note.md" },
			outputFolder: "../escape",
			outputFilename: "Note",
		});

		expect(outcome).toMatchObject({ ok: false, reason: "invalid-plan" });
	});

	it("passes progress callbacks through to the run", async () => {
		const fixture = createMemoryVault();
		fixture.putText("Note.md", "Body");
		const onFileStart = vi.fn();

		await runExport(fixture.app, settings, {
			source: { type: "current-file", path: "Note.md" },
			outputFolder: "out",
			outputFilename: "Note",
		}, {
			writer: new MemoryTarget(),
			queryRenderer,
			callbacks: { onFileStart, onFileComplete: vi.fn(), onPhase: vi.fn() },
		});

		expect(onFileStart).toHaveBeenCalledWith(0, 1, "Note");
	});
});
