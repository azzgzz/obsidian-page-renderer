import { App, TFile, TFolder } from "obsidian";
import { ExportSource } from "@/types";
import { isFolder, isMarkdown } from "@/export/utils";

/** All Markdown notes under the folder, nested folders included. */
export function collectMarkdownFiles(folder: TFolder): TFile[] {
	const files: TFile[] = [];
	for (const child of folder.children) {
		if (isMarkdown(child)) {
			files.push(child);
		} else if (isFolder(child)) {
			files.push(...collectMarkdownFiles(child));
		}
	}
	return files;
}

/** The folder itself plus every folder nested under it. */
export function collectFolders(root: TFolder): TFolder[] {
	const folders: TFolder[] = [root];
	for (const child of root.children) {
		if (isFolder(child)) folders.push(...collectFolders(child));
	}
	return folders;
}

export class ExportSourceResolver {
	private app: App;

	constructor(app: App) {
		this.app = app;
	}

	resolve(source: ExportSource): TFile[] {
		switch (source.type) {
			case "current-file":
				return source.path ? this.markdownAt([source.path]) : [];
			case "files":
				return this.markdownAt(source.paths);
			case "folder": {
				const folder = this.app.vault.getAbstractFileByPath(source.path);
				return isFolder(folder) ? collectMarkdownFiles(folder) : [];
			}
		}
	}

	private markdownAt(paths: string[]): TFile[] {
		return paths
			.map((path) => this.app.vault.getAbstractFileByPath(path))
			.filter(isMarkdown);
	}
}
