import { describe, it, expect } from "vitest";
import { parseCliExport, runCliExport, toVaultPath } from "@/cli/CliExport";
import { DEFAULT_SETTINGS } from "@/types";
import { createMemoryVault } from "@/test-support/memory-vault";

const BASE = "/Users/me/vault";
const DEFAULT_OUT = "exports";

describe("toVaultPath", () => {
	it("converts an absolute path inside the vault to a vault-relative one", () => {
		expect(toVaultPath(`${BASE}/notes/a.md`, BASE)).toBe("notes/a.md");
	});

	it("tolerates a trailing slash in the base path", () => {
		expect(toVaultPath(`${BASE}/a.md`, `${BASE}/`)).toBe("a.md");
	});

	it("rejects an absolute path outside the vault", () => {
		expect(toVaultPath("/Users/me/other/a.md", BASE)).toBeNull();
		expect(toVaultPath(`${BASE}-copy/a.md`, BASE)).toBeNull();
	});

	it("rejects an absolute path when the vault has no base path", () => {
		expect(toVaultPath(`${BASE}/a.md`, null)).toBeNull();
	});

	it("keeps a relative path as vault-relative", () => {
		expect(toVaultPath("notes/a.md", BASE)).toBe("notes/a.md");
		expect(toVaultPath("./a.md", BASE)).toBe("a.md");
	});

	it("rejects parent directory traversal in a relative path", () => {
		expect(toVaultPath("../a.md", BASE)).toBeNull();
		expect(toVaultPath("notes/../../a.md", BASE)).toBeNull();
	});

	it("handles Windows paths", () => {
		expect(toVaultPath("C:\\Users\\me\\vault\\notes\\a.md", "C:\\Users\\me\\vault"))
			.toBe("notes/a.md");
	});

	it("returns null for empty input", () => {
		expect(toVaultPath("   ", BASE)).toBeNull();
	});
});

describe("parseCliExport", () => {
	it("applies defaults: plugin output folder, overwrite on, print to stdout", () => {
		expect(parseCliExport({ file: `${BASE}/note.md` }, BASE, DEFAULT_OUT)).toEqual({
			ok: true,
			request: {
				file: "note.md",
				outputFolder: DEFAULT_OUT,
				overwrite: true,
				printToFile: false,
			},
		});
	});

	it("prints to stdout only when printToFile is explicitly true", () => {
		const printToFile = (value?: string) => parseCliExport(
			{ file: "a.md", ...(value === undefined ? {} : { printToFile: value }) },
			BASE,
			DEFAULT_OUT,
		);
		expect(printToFile()).toMatchObject({ ok: true, request: { printToFile: false } });
		expect(printToFile("false")).toMatchObject({ ok: true, request: { printToFile: false } });
		expect(printToFile("true")).toMatchObject({ ok: true, request: { printToFile: true } });
		expect(printToFile("TRUE")).toMatchObject({ ok: true, request: { printToFile: true } });
	});

	it("uses an explicit output folder without trailing slashes", () => {
		expect(parseCliExport({ file: "a.md", output: "out/pages/" }, BASE, DEFAULT_OUT))
			.toMatchObject({ ok: true, request: { outputFolder: "out/pages" } });
	});

	it("turns overwrite off only for an explicit false", () => {
		expect(parseCliExport({ file: "a.md", overwrite: "false" }, BASE, DEFAULT_OUT))
			.toMatchObject({ ok: true, request: { overwrite: false } });
		expect(parseCliExport({ file: "a.md", overwrite: "true" }, BASE, DEFAULT_OUT))
			.toMatchObject({ ok: true, request: { overwrite: true } });
	});

	it("fails without a file parameter", () => {
		expect(parseCliExport({}, BASE, DEFAULT_OUT)).toEqual({ ok: false, error: "Missing required parameter: file" });
		expect(parseCliExport({ file: "true" }, BASE, DEFAULT_OUT)).toMatchObject({ ok: false });
	});

	it("fails for a file outside the vault", () => {
		expect(parseCliExport({ file: "/tmp/a.md" }, BASE, DEFAULT_OUT))
			.toEqual({ ok: false, error: "File is outside the vault: /tmp/a.md" });
	});

	it("fails for a non-Markdown file", () => {
		expect(parseCliExport({ file: "a.txt" }, BASE, DEFAULT_OUT))
			.toEqual({ ok: false, error: "Not a Markdown note: a.txt" });
	});

	it("has no format parameter: a legacy format value is ignored", () => {
		const plain = parseCliExport({ file: "a.md" }, BASE, DEFAULT_OUT);
		for (const format of ["pdf", "docx", "epub", "html", "md", "mdr", "rtf"]) {
			expect(parseCliExport({ file: "a.md", format }, BASE, DEFAULT_OUT)).toEqual(plain);
		}
	});
});

describe("runCliExport", () => {
	function vaultWith(files: Record<string, string>) {
		const fixture = createMemoryVault();
		for (const [path, text] of Object.entries(files)) fixture.putText(path, text);
		(fixture.app.vault as { adapter?: unknown }).adapter = {};
		return fixture;
	}

	it("prints the rendered Markdown by default and writes nothing", async () => {
		const fixture = vaultWith({ "Note.md": "# Note\n\nBody\n" });

		const output = await runCliExport(fixture.app, DEFAULT_SETTINGS, { file: "Note.md" });

		expect(output).toBe("# Note\n\nBody\n\n");
		expect(fixture.paths()).toEqual(["Note.md"]);
	});

	it("names a missing note", async () => {
		const fixture = vaultWith({});

		expect(await runCliExport(fixture.app, DEFAULT_SETTINGS, { file: "Missing.md" }))
			.toBe("Error: Note not found in the vault: Missing.md");
	});

	it("rejects an unusable output folder", async () => {
		const fixture = vaultWith({ "Note.md": "Body" });

		const output = await runCliExport(fixture.app, DEFAULT_SETTINGS, {
			file: "Note.md", output: "../escape", printToFile: "true",
		});

		expect(output).toMatch(/^Error: .*parent directory traversal/);
	});

	it("writes into the vault with printToFile=true and lists the output", async () => {
		const fixture = vaultWith({ "Note.md": "Body" });

		const output = await runCliExport(fixture.app, DEFAULT_SETTINGS, {
			file: "Note.md", printToFile: "true", output: "out",
		});

		expect(output).toContain("Export complete");
		expect(output).toContain("out/Note.md");
		expect(fixture.text("out/Note.md")).toContain("Body");
	});
});
