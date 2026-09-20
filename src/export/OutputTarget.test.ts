import { describe, it, expect, vi, afterEach } from "vitest";
import { TFile } from "obsidian";
import {
	createOutputTarget,
	FileSystemTarget,
	MemoryTarget,
	supportsExternalPaths,
	VaultTarget,
} from "@/export/OutputTarget";

function createMockApp(files: Record<string, { extension: string; content?: ArrayBuffer }> = {}) {
	const mockFiles = new Map<string, TFile>();
	const binaryContents = new Map<string, ArrayBuffer>();

	for (const [path, opts] of Object.entries(files)) {
		const f = new TFile();
		f.path = path;
		f.extension = opts.extension;
		mockFiles.set(path, f);
		if (opts.content) binaryContents.set(path, opts.content);
	}

	return {
		vault: {
			getAbstractFileByPath: vi.fn((path: string) => mockFiles.get(path) ?? null),
			createFolder: vi.fn(),
			create: vi.fn(),
			modify: vi.fn(),
			createBinary: vi.fn(),
			modifyBinary: vi.fn(),
			readBinary: vi.fn((file: TFile) => binaryContents.get(file.path) ?? new ArrayBuffer(0)),
			adapter: {},
		},
	};
}

describe("OutputTarget", () => {
	describe("supportsExternalPaths", () => {
		it("returns true on desktop", () => {
			expect(supportsExternalPaths()).toBe(true);
		});
	});

	describe("ensureFolder", () => {
		it("creates nested vault folders", async () => {
			const app = createMockApp();
			const writer = new VaultTarget(app as never);
			await writer.ensureFolder("a/b/c");
			expect(app.vault.createFolder).toHaveBeenCalledTimes(3);
			expect(app.vault.createFolder).toHaveBeenCalledWith("a");
			expect(app.vault.createFolder).toHaveBeenCalledWith("a/b");
			expect(app.vault.createFolder).toHaveBeenCalledWith("a/b/c");
		});

		it("skips existing folders", async () => {
			const app = createMockApp();
			app.vault.getAbstractFileByPath = vi.fn((path: string) =>
				path === "a" ? { path: "a", children: [] } : null,
			) as never;
			const writer = new VaultTarget(app as never);
			await writer.ensureFolder("a/b");
			expect(app.vault.createFolder).toHaveBeenCalledTimes(1);
			expect(app.vault.createFolder).toHaveBeenCalledWith("a/b");
		});
	});

	describe("writeText", () => {
		it("creates new vault file", async () => {
			const app = createMockApp();
			const writer = new VaultTarget(app as never);
			await writer.writeText("output/doc.md", "# Hello");
			expect(app.vault.create).toHaveBeenCalledWith("output/doc.md", "# Hello");
		});

		it("modifies an existing vault file when overwrite is enabled", async () => {
			const app = createMockApp({ "output/doc.md": { extension: "md" } });
			const writer = new VaultTarget(app as never);
			await writer.writeText("output/doc.md", "# Updated");
			expect(app.vault.modify).toHaveBeenCalledWith(
				expect.objectContaining({ path: "output/doc.md" }),
				"# Updated",
			);
			expect(app.vault.create).not.toHaveBeenCalled();
		});

		it("refuses to modify an existing vault file when overwrite is disabled", async () => {
			const app = createMockApp({ "output/doc.md": { extension: "md" } });
			const writer = new VaultTarget(app as never, false);
			await expect(writer.writeText("output/doc.md", "# Updated"))
				.rejects.toThrow("Output already exists: output/doc.md");
			expect(app.vault.modify).not.toHaveBeenCalled();
			expect(app.vault.create).not.toHaveBeenCalled();
		});

		it("refuses to write when a folder occupies the destination", async () => {
			const app = createMockApp();
			app.vault.getAbstractFileByPath = vi.fn(() => ({ path: "output", children: [] })) as never;
			const writer = new VaultTarget(app as never, false);
			await expect(writer.writeText("output/doc.md", "# Hello"))
				.rejects.toThrow("Output already exists: output/doc.md");
			expect(app.vault.create).not.toHaveBeenCalled();
		});
	});

	describe("writeBinary overwrite policy", () => {
		it("modifies an existing vault file when overwrite is enabled", async () => {
			const app = createMockApp({ "output/img.png": { extension: "png" } });
			const writer = new VaultTarget(app as never);
			await writer.writeBinary("output/img.png", new Uint8Array([1]));
			expect(app.vault.modifyBinary).toHaveBeenCalled();
			expect(app.vault.createBinary).not.toHaveBeenCalled();
		});

		it("refuses to modify an existing vault file when overwrite is disabled", async () => {
			const app = createMockApp({ "output/img.png": { extension: "png" } });
			const writer = new VaultTarget(app as never, false);
			await expect(writer.writeBinary("output/img.png", new Uint8Array([1])))
				.rejects.toThrow("Output already exists: output/img.png");
			expect(app.vault.modifyBinary).not.toHaveBeenCalled();
			expect(app.vault.createBinary).not.toHaveBeenCalled();
		});
	});

	describe("external write policy", () => {
		// Node builtins are imported dynamically to satisfy the obsidianmd lint rules.
		async function externalTarget(overwrite: boolean) {
			const { createRequire } = await import("node:module");
			vi.stubGlobal("window", { require: createRequire(import.meta.url) });
			return new FileSystemTarget(createMockApp() as never, overwrite);
		}

		async function tempDir(): Promise<{ dir: string; fs: typeof import("node:fs") }> {
			const [fs, os, path] = await Promise.all([
				import("node:fs"), import("node:os"), import("node:path"),
			]);
			return { dir: fs.mkdtempSync(path.join(os.tmpdir(), "writer-ext-")), fs };
		}

		afterEach(() => {
			vi.unstubAllGlobals();
		});

		it("refuses to modify an existing external file when overwrite is disabled", async () => {
			const { dir, fs } = await tempDir();
			try {
				const target = `${dir}/note.md`;
				fs.writeFileSync(target, "original");
				const writer = await externalTarget(false);
				await expect(writer.writeText(target, "replacement")).rejects.toThrow();
				expect(fs.readFileSync(target, "utf-8")).toBe("original");
			} finally {
				fs.rmSync(dir, { recursive: true, force: true });
			}
		});

		it("refuses to modify an existing external binary when overwrite is disabled", async () => {
			const { dir, fs } = await tempDir();
			try {
				const target = `${dir}/img.png`;
				fs.writeFileSync(target, new Uint8Array([1]));
				const writer = await externalTarget(false);
				await expect(writer.writeBinary(target, new Uint8Array([2]))).rejects.toThrow();
				expect(Array.from(fs.readFileSync(target))).toEqual([1]);
			} finally {
				fs.rmSync(dir, { recursive: true, force: true });
			}
		});

		it("overwrites external files when overwrite is enabled", async () => {
			const { dir, fs } = await tempDir();
			try {
				const target = `${dir}/note.md`;
				fs.writeFileSync(target, "original");
				const writer = await externalTarget(true);
				await writer.writeText(target, "replacement");
				expect(fs.readFileSync(target, "utf-8")).toBe("replacement");
			} finally {
				fs.rmSync(dir, { recursive: true, force: true });
			}
		});

		it("creates missing folders and reports existing paths", async () => {
			const { dir, fs } = await tempDir();
			try {
				const writer = await externalTarget(true);
				await writer.ensureFolder(`${dir}/a/b`);
				expect(fs.existsSync(`${dir}/a/b`)).toBe(true);
				expect(writer.folderExists(`${dir}/a/b`)).toBe(true);
				expect(writer.pathExists(`${dir}/missing`)).toBe(false);
			} finally {
				fs.rmSync(dir, { recursive: true, force: true });
			}
		});
	});

	describe("writeBinary", () => {
		it("throws instead of silently succeeding when external fs access is unavailable", async () => {
			const app = createMockApp();
			const writer = new FileSystemTarget(app as never);

			await expect(writer.writeBinary("/tmp/export.pdf", new Uint8Array([1, 2, 3])))
				.rejects.toThrow("External file system access is not available");
		});
	});

	describe("copyBinaryFile", () => {
		it("copies binary within vault using vault API", async () => {
			const buf = new ArrayBuffer(8);
			const app = createMockApp({
				"assets/img.png": { extension: "png", content: buf },
			});
			const writer = new VaultTarget(app as never);
			await writer.copyBinaryFile("assets/img.png", "output/img.png");
			expect(app.vault.readBinary).toHaveBeenCalled();
			expect(app.vault.createBinary).toHaveBeenCalledWith("output/img.png", buf);
		});

		it("throws when the source attachment is not found", async () => {
			const app = createMockApp();
			const writer = new VaultTarget(app as never);
			await expect(writer.copyBinaryFile("missing.png", "output/missing.png"))
				.rejects.toThrow("Attachment source not found: missing.png");
			expect(app.vault.readBinary).not.toHaveBeenCalled();
			expect(app.vault.createBinary).not.toHaveBeenCalled();
		});
	});

	describe("folderExists", () => {
		it("returns true for existing vault folder", () => {
			const app = createMockApp();
			app.vault.getAbstractFileByPath = vi.fn(() => ({ path: "folder", children: [] })) as never;
			const writer = new VaultTarget(app as never);
			expect(writer.folderExists("folder")).toBe(true);
		});

		it("returns false for non-existing path", () => {
			const app = createMockApp();
			const writer = new VaultTarget(app as never);
			expect(writer.folderExists("nope")).toBe(false);
		});
	});

	describe("pathExists", () => {
		it("returns true for an existing vault file", () => {
			const app = createMockApp({
				"exports/note.pdf": { extension: "pdf" },
			});
			const writer = new VaultTarget(app as never);
			expect(writer.pathExists("exports/note.pdf")).toBe(true);
		});

		it("returns false for a missing vault path", () => {
			const app = createMockApp();
			const writer = new VaultTarget(app as never);
			expect(writer.pathExists("exports/missing.pdf")).toBe(false);
		});
	});

	describe("createOutputTarget", () => {
		it("picks the file system for absolute output roots", () => {
			const app = createMockApp() as never;
			expect(createOutputTarget(app, "/home/user/exports", true)).toBeInstanceOf(FileSystemTarget);
			expect(createOutputTarget(app, "C:\\exports", true)).toBeInstanceOf(FileSystemTarget);
		});

		it("picks the vault for relative output roots", () => {
			expect(createOutputTarget(createMockApp() as never, "exports", true)).toBeInstanceOf(VaultTarget);
		});
	});

	describe("MemoryTarget", () => {
		it("keeps written text and binary data in memory", async () => {
			const target = new MemoryTarget();
			await target.writeText("out/note.md", "hi");
			await target.writeBinary("out/img.png", new Uint8Array([1, 2, 3]).buffer);
			expect(target.files.get("out/note.md")).toBe("hi");
			expect(target.files.get("out/img.png")).toEqual(new Uint8Array([1, 2, 3]));
		});

		it("overwrites a repeated write to the same path", async () => {
			const target = new MemoryTarget();
			await target.writeText("a.md", "one");
			await target.writeText("a.md", "two");
			expect(target.files.get("a.md")).toBe("two");
		});

		it("reports that no path or folder exists and copies nothing", async () => {
			const target = new MemoryTarget();
			await target.ensureFolder();
			await target.copyBinaryFile();
			expect(target.pathExists()).toBe(false);
			expect(target.folderExists()).toBe(false);
			expect(target.files.size).toBe(0);
		});
	});
});
