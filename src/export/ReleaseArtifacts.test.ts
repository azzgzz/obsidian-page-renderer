import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { deflateSync } from "node:zlib";
import { createHash } from "node:crypto";
import { Buffer } from "node:buffer";
import { env as nodeEnv } from "node:process";
import * as nodeFs from "node:fs";
import * as nodePath from "node:path";
import { ExportRunner } from "@/export/ExportRunner";
import { buildExportPlan } from "@/export/ExportPlan";
import { DEFAULT_SETTINGS, ExportSettings, ExportSource } from "@/types";
import { createMemoryVault } from "@/test-support/memory-vault";

// Headless contract suite: the real plan → runner → collector → rewriter →
// renderer → writer pipeline against a persistent in-memory vault. Query
// blocks stay untouched here (no Obsidian DOM). Fixture notes mirror the
// marker text of scripts/create-release-fixtures.mjs.

const RED = [210, 30, 30] as const;
const BLUE = [30, 30, 210] as const;

function png(width: number, height: number, rgb: readonly [number, number, number]): Uint8Array {
	const crc32 = (bytes: Uint8Array): number => {
		let crc = 0xffffffff;
		for (const byte of bytes) {
			crc ^= byte;
			for (let bit = 0; bit < 8; bit++) {
				crc = (crc >>> 1) ^ ((crc & 1) ? 0xedb88320 : 0);
			}
		}
		return (crc ^ 0xffffffff) >>> 0;
	};
	const chunk = (type: string, data: Buffer): Buffer => {
		const label = Buffer.from(type, "ascii");
		const length = Buffer.alloc(4);
		length.writeUInt32BE(data.length);
		const checksum = Buffer.alloc(4);
		checksum.writeUInt32BE(crc32(Buffer.concat([label, data])));
		return Buffer.concat([length, label, data, checksum]);
	};
	const ihdr = Buffer.alloc(13);
	ihdr.writeUInt32BE(width, 0);
	ihdr.writeUInt32BE(height, 4);
	ihdr[8] = 8;
	ihdr[9] = 2;
	const pixels = Buffer.alloc(height * (1 + width * 3));
	for (let y = 0; y < height; y++) {
		const row = y * (1 + width * 3);
		pixels[row] = 0;
		for (let x = 0; x < width; x++) {
			const offset = row + 1 + x * 3;
			pixels[offset] = rgb[0];
			pixels[offset + 1] = rgb[1];
			pixels[offset + 2] = rgb[2];
		}
	}
	return new Uint8Array(Buffer.concat([
		Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]),
		chunk("IHDR", ihdr),
		chunk("IDAT", deflateSync(pixels)),
		chunk("IEND", Buffer.alloc(0)),
	]));
}

function sha256Hex(data: Uint8Array): string {
	return createHash("sha256").update(data).digest("hex");
}

function buildFixtureVault() {
	const fixture = createMemoryVault();
	fixture.putText("content.md", [
		"---", "title: Release acceptance", "---", "# Release acceptance", "",
		"BEGIN-CONTENT 中文导出 😀 café", "",
		"## Heading two", "### Heading three", "#### Heading four",
		"##### Heading five", "###### Heading six", "",
		"**Bold** and *italic* and `inline code`.", "",
		"1. Ordered one", "2. Ordered two", "", "- Bullet one", "- Bullet two", "",
		"| Name | Value |", "| --- | --- |", "| Alpha | 123 |", "| 中文 | 456 |", "",
		"```ts", "const sentinel = 'CODE-CONTENT';", "```", "",
		"[External link](https://example.com/)", "",
		"![Landscape](images/landscape.png)", "",
		"![Portrait](images/portrait.png)", "", "END-CONTENT", "",
	].join("\n"));
	fixture.putBinary("images/landscape.png", png(640, 240, RED));
	fixture.putBinary("images/portrait.png", png(240, 640, BLUE));
	fixture.putText("folder/index.md", "# Folder index\n\n[[nested/part]]\n\n![[nested/part]]\n\nEND-INDEX\n");
	fixture.putText("folder/nested/part.md", "# Nested part\n\nEMBED-SENTINEL\n\n![Local](../../images/landscape.png)\n\n[[../index]]\n");
	fixture.putText("folder/nested/third.md", "# Third\n\nTHIRD-SENTINEL\n\n[[part]]\n");
	fixture.putText("collision/a/A.md", "# Collision A\n\nRed image:\n\n![[img.png]]\n");
	fixture.putText("collision/b/B.md", "# Collision B\n\nBlue image:\n\n![[img.png]]\n");
	fixture.putBinary("collision/a/img.png", png(160, 100, RED));
	fixture.putBinary("collision/b/img.png", png(160, 100, BLUE));
	fixture.putText("export-report.md", "# Preserve this document\n\nREPORT-DOCUMENT-SENTINEL\n\n[[MissingReportTarget]]\n");
	fixture.putText("tasks.md", "# Tasks\n\n- [ ] Task item\n- [x] Done item\n\nTASK-LIST-SENTINEL\n");
	return fixture;
}

type FixtureVault = ReturnType<typeof buildFixtureVault>;

const SETTINGS: ExportSettings = {
	...DEFAULT_SETTINGS,
	expandEmbeds: true,
	copyAttachments: true,
	overwriteExisting: false,
};

function runExport(
	fixture: FixtureVault,
	source: ExportSource,
	outputFilename: string,
	outputFolderName?: string,
	callbacks?: Parameters<ExportRunner["run"]>[2],
) {
	const plan = buildExportPlan({
		source,
		inputFiles: source.type === "folder"
			? ["folder/index.md", "folder/nested/part.md", "folder/nested/third.md"]
			: [source.type === "current-file" ? source.path : source.paths[0]],
		outputRoot: "exports",
		outputFilename,
		outputFolderName,
	});
	return new ExportRunner(fixture.app).run(plan, SETTINGS, callbacks);
}

// Optional artifact persistence: only this test file writes outputs, only
// when RELEASE_ARTIFACT_DIR names a new or empty directory. Ordinary CI runs
// leave nothing on disk.
const artifactRoot = nodeEnv.RELEASE_ARTIFACT_DIR;
const artifactIndex: Record<string, unknown>[] = [];

beforeAll(() => {
	if (!artifactRoot) return;
	if (nodeFs.existsSync(artifactRoot)) {
		if (!nodeFs.statSync(artifactRoot).isDirectory() || nodeFs.readdirSync(artifactRoot).length > 0) {
			throw new Error(`RELEASE_ARTIFACT_DIR must be a new or empty directory: ${artifactRoot}`);
		}
	} else {
		nodeFs.mkdirSync(artifactRoot, { recursive: true });
	}
});

afterAll(() => {
	if (!artifactRoot) return;
	nodeFs.writeFileSync(
		nodePath.join(artifactRoot, "index.json"),
		JSON.stringify(artifactIndex, null, 2) + "\n",
		{ flag: "wx" },
	);
});

function persistCase(
	caseName: string,
	fixture: FixtureVault,
	result: { outputRoot: string; status: string; warnings: string[]; errors: string[] },
	rendering: string,
) {
	if (!artifactRoot) return;
	const caseDir = nodePath.join(artifactRoot, caseName);
	nodeFs.mkdirSync(caseDir);
	const files: { path: string; sha256: string }[] = [];
	for (const p of fixture.paths()) {
		if (!p.startsWith(`${result.outputRoot}/`) || !fixture.isFile(p)) continue;
		const relative = p.slice(result.outputRoot.length + 1);
		const target = nodePath.join(caseDir, relative);
		nodeFs.mkdirSync(nodePath.dirname(target), { recursive: true });
		let buffer: Buffer;
		try {
			buffer = Buffer.from(fixture.text(p), "utf8");
		} catch {
			buffer = Buffer.from(fixture.bytes(p));
		}
		nodeFs.writeFileSync(target, buffer, { flag: "wx" });
		files.push({ path: relative, sha256: sha256Hex(new Uint8Array(buffer)) });
	}
	artifactIndex.push({
		case: caseName,
		rendering,
		settings: SETTINGS,
		status: result.status,
		outputRoot: result.outputRoot,
		warnings: result.warnings,
		errors: result.errors,
		files,
	});
}

describe("release artifacts (headless)", () => {
	it("exports content.md with markers, table, code and identical image bytes", async () => {
		const fixture = buildFixtureVault();
		const result = await runExport(
			fixture, { type: "current-file", path: "content.md" }, "content",
		);

		expect(result.status).toBe("completed");
		const markdown = fixture.text("exports/content.md");
		expect(markdown).toContain("BEGIN-CONTENT 中文导出 😀 café");
		expect(markdown).toContain("END-CONTENT");
		expect(markdown).toContain("| Alpha | 123 |");
		expect(markdown).toContain("| 中文 | 456 |");
		expect(markdown).toContain("CODE-CONTENT");
		expect(markdown).toContain("assets/landscape.png");
		expect(markdown).toContain("assets/portrait.png");
		expect(fixture.bytes("exports/assets/landscape.png"))
			.toEqual(fixture.bytes("images/landscape.png"));
		expect(fixture.bytes("exports/assets/portrait.png"))
			.toEqual(fixture.bytes("images/portrait.png"));
		persistCase("content-markdown", fixture, result, "headless:markdown-rendered");
	});

	it("keeps task list items as Markdown checkboxes", async () => {
		const fixture = buildFixtureVault();
		const result = await runExport(
			fixture, { type: "current-file", path: "tasks.md" }, "tasks",
		);

		expect(result.status).toBe("completed");
		const markdown = fixture.text("exports/tasks.md");
		expect(markdown).toContain("TASK-LIST-SENTINEL");
		expect(markdown).toContain("- [ ] Task item");
		expect(markdown).toContain("- [x] Done item");
	});

	describe("folder batch", () => {
		const folderSource: ExportSource = { type: "folder", path: "folder" };

		it("preserves nested primaries, relative links and shared attachment bytes in Markdown", async () => {
			const fixture = buildFixtureVault();
			const result = await runExport(
				fixture, folderSource, "index", "folder",
			);

			expect(result.status).toBe("completed");
			expect(result.completedFiles).toBe(3);
			for (const primary of [
				"exports/folder/index.md",
				"exports/folder/nested/part.md",
				"exports/folder/nested/third.md",
			]) {
				expect(fixture.isFile(primary)).toBe(true);
			}

			const index = fixture.text("exports/folder/index.md");
			expect(index).toContain("END-INDEX");
			// The expanded embed carries EMBED-SENTINEL; links stay relative.
			expect(index).toContain("EMBED-SENTINEL");
			expect(index).toContain("(nested/part.md)");
			expect(index).toContain("assets/landscape.png");

			const part = fixture.text("exports/folder/nested/part.md");
			expect(part).toContain("EMBED-SENTINEL");
			expect(part).toContain("../assets/landscape.png");
			expect(part).toContain("(../index.md)");

			const third = fixture.text("exports/folder/nested/third.md");
			expect(third).toContain("THIRD-SENTINEL");
			expect(third).toContain("(part.md)");

			expect(fixture.bytes("exports/folder/assets/landscape.png"))
				.toEqual(fixture.bytes("images/landscape.png"));
			persistCase("folder-markdown", fixture, result, "headless:markdown-rendered");
		});

	});

	it("keeps collision A intact while B exports its blue image to a separate root", async () => {
		const fixture = buildFixtureVault();
		const run = (path: string, name: string) => runExport(
			fixture, { type: "current-file", path }, name,
		);

		const first = await run("collision/a/A.md", "A");
		const originalDocument = fixture.text("exports/A.md");
		const originalHash = sha256Hex(fixture.bytes("exports/assets/img.png"));
		const second = await run("collision/b/B.md", "B");

		expect(first.status).toBe("completed");
		expect(second.status).toBe("completed");
		expect(fixture.text("exports/A.md")).toBe(originalDocument);
		expect(sha256Hex(fixture.bytes("exports/assets/img.png"))).toBe(originalHash);
		expect(second.outputRoot).not.toBe("exports");
		expect(fixture.bytes(`${second.outputRoot}/assets/img.png`))
			.toEqual(fixture.bytes("collision/b/img.png"));
		expect(fixture.text(`${second.outputRoot}/B.md`)).toContain("assets/img.png");
	});

	it("keeps a primary named export-report.md and writes warnings to a distinct report", async () => {
		const fixture = buildFixtureVault();
		const result = await runExport(
			fixture, { type: "current-file", path: "export-report.md" }, "export-report",
		);

		expect(result.status).toBe("completed");
		expect(fixture.text("exports/export-report.md")).toContain("REPORT-DOCUMENT-SENTINEL");
		expect(fixture.isFile("exports/export-report-2.md")).toBe(true);
		expect(fixture.text("exports/export-report-2.md")).toContain("Unresolved link: MissingReportTarget");
		expect(result.reportPath).toBe("exports/export-report-2.md");
	});

	it("reports a missing required attachment as failed, never completed", async () => {
		const fixture = buildFixtureVault();
		const callbacks = {
			onFileStart: () => {},
			onFileComplete: () => {},
			onPhase: (phase: string) => {
				if (phase === "Copying attachments") fixture.remove("images/landscape.png");
			},
		};
		const result = await runExport(
			fixture, { type: "current-file", path: "content.md" }, "content",
			undefined, callbacks,
		);

		expect(result.status).toBe("failed");
		expect(result.success).toBe(false);
		expect(result.incompletePaths).toContain("exports/content.md");
		expect(result.errors).toContain("Failed to copy attachment: images/landscape.png");
	});

	it("reports cancellation with the incomplete primary instead of success", async () => {
		const fixture = buildFixtureVault();
		const runner = new ExportRunner(fixture.app);
		const plan = buildExportPlan({
			source: { type: "current-file", path: "content.md" },
			inputFiles: ["content.md"],
			outputRoot: "exports",
			outputFilename: "content",
		});
		const result = await runner.run(plan, SETTINGS, {
			onFileStart: () => {},
			onFileComplete: () => {},
			onPhase: (phase) => phase === "Copying attachments" && runner.cancel(),
		});

		expect(result.status).toBe("cancelled");
		expect(result.success).toBe(false);
		expect(result.completedFiles).toBe(0);
		expect(result.incompletePaths).toContain("exports/content.md");
	});
});
