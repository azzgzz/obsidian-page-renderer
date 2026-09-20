import { App, Platform, TFile } from "obsidian";
import { isExternalPath, isFile } from "@/export/utils";

/** Where an export writes its files: the vault, the file system or memory. */
export interface OutputTarget {
	ensureFolder(folderPath: string): Promise<void>;
	writeText(filePath: string, content: string): Promise<void>;
	writeBinary(filePath: string, data: ArrayBuffer | Uint8Array): Promise<void>;
	/** Copies a vault file (`sourcePath`) to `destPath` of this target. */
	copyBinaryFile(sourcePath: string, destPath: string): Promise<void>;
	folderExists(folderPath: string): boolean;
	pathExists(path: string): boolean;
}

export function supportsExternalPaths(): boolean {
	return Platform.isDesktopApp;
}

/** Picks the backend once per export from where its output root lives. */
export function createOutputTarget(
	app: App,
	outputRoot: string,
	overwriteExisting: boolean,
): OutputTarget {
	return isExternalPath(outputRoot)
		? new FileSystemTarget(app, overwriteExisting)
		: new VaultTarget(app, overwriteExisting);
}

async function readVaultBinary(app: App, sourcePath: string): Promise<ArrayBuffer> {
	const sourceFile = app.vault.getAbstractFileByPath(sourcePath);
	if (!isFile(sourceFile)) {
		throw new Error(`Attachment source not found: ${sourcePath}`);
	}
	return app.vault.readBinary(sourceFile);
}

export class VaultTarget implements OutputTarget {
	constructor(
		private readonly app: App,
		private readonly overwriteExisting = true,
	) {}

	async ensureFolder(folderPath: string): Promise<void> {
		let current = "";
		for (const part of folderPath.split("/").filter(Boolean)) {
			current = current ? `${current}/${part}` : part;
			if (!this.app.vault.getAbstractFileByPath(current)) {
				await this.app.vault.createFolder(current);
			}
		}
	}

	async writeText(filePath: string, content: string): Promise<void> {
		const existing = this.existingFile(filePath);
		if (existing) {
			await this.app.vault.modify(existing, content);
			return;
		}
		await this.app.vault.create(filePath, content);
	}

	async writeBinary(filePath: string, data: ArrayBuffer | Uint8Array): Promise<void> {
		const buffer = data instanceof ArrayBuffer ? data : uint8ArrayToArrayBuffer(data);
		const existing = this.existingFile(filePath);
		if (existing) {
			await this.app.vault.modifyBinary(existing, buffer);
			return;
		}
		await this.app.vault.createBinary(filePath, buffer);
	}

	async copyBinaryFile(sourcePath: string, destPath: string): Promise<void> {
		await this.writeBinary(destPath, await readVaultBinary(this.app, sourcePath));
	}

	folderExists(folderPath: string): boolean {
		const folder = this.app.vault.getAbstractFileByPath(folderPath);
		return folder !== null && "children" in folder;
	}

	pathExists(path: string): boolean {
		return this.app.vault.getAbstractFileByPath(path) !== null;
	}

	/** The file to replace, null when the path is free; throws when it may not be replaced. */
	private existingFile(filePath: string): TFile | null {
		const existing = this.app.vault.getAbstractFileByPath(filePath);
		if (!existing) return null;
		if (!this.overwriteExisting || !isFile(existing)) {
			throw new Error(`Output already exists: ${filePath}`);
		}
		return existing;
	}
}

export class FileSystemTarget implements OutputTarget {
	constructor(
		private readonly app: App,
		private readonly overwriteExisting = true,
	) {}

	async ensureFolder(folderPath: string): Promise<void> {
		this.getFs().mkdirSync(folderPath, { recursive: true });
	}

	async writeText(filePath: string, content: string): Promise<void> {
		this.getFs().writeFileSync(filePath, content, {
			encoding: "utf-8",
			flag: this.writeFlag(),
		});
	}

	async writeBinary(filePath: string, data: ArrayBuffer | Uint8Array): Promise<void> {
		this.getFs().writeFileSync(
			filePath,
			data instanceof Uint8Array ? data : new Uint8Array(data),
			{ flag: this.writeFlag() },
		);
	}

	async copyBinaryFile(sourcePath: string, destPath: string): Promise<void> {
		await this.writeBinary(destPath, await readVaultBinary(this.app, sourcePath));
	}

	folderExists(folderPath: string): boolean {
		return this.pathExists(folderPath);
	}

	pathExists(path: string): boolean {
		return resolveNodeFs()?.existsSync(path) ?? false;
	}

	// "wx" makes the file system itself refuse to replace an existing file.
	private writeFlag(): string {
		return this.overwriteExisting ? "w" : "wx";
	}

	private getFs(): typeof import("fs") {
		const fs = resolveNodeFs();
		if (!fs) throw new Error("External file system access is not available");
		return fs;
	}
}

/** Resolved lazily: `window.require` exists only inside Obsidian's desktop app. */
function resolveNodeFs(): typeof import("fs") | null {
	const g = typeof window !== "undefined" ? window : undefined;
	return g && "require" in g
		? (g as unknown as Record<string, (id: string) => unknown>)["require"]("fs") as typeof import("fs")
		: null;
}

/**
 * Keeps output in memory instead of writing it to the vault or disk.
 * Attachments are not copied, so links to them keep pointing at the paths the
 * export would have used.
 */
export class MemoryTarget implements OutputTarget {
	readonly files = new Map<string, string | Uint8Array>();

	async ensureFolder(): Promise<void> {}

	async writeText(filePath: string, content: string): Promise<void> {
		this.files.set(filePath, content);
	}

	async writeBinary(filePath: string, data: ArrayBuffer | Uint8Array): Promise<void> {
		this.files.set(filePath, data instanceof Uint8Array ? data : new Uint8Array(data));
	}

	async copyBinaryFile(): Promise<void> {}

	folderExists(): boolean {
		return false;
	}

	pathExists(): boolean {
		return false;
	}
}

function uint8ArrayToArrayBuffer(data: Uint8Array): ArrayBuffer {
	const buffer = new ArrayBuffer(data.byteLength);
	new Uint8Array(buffer).set(data);
	return buffer;
}
