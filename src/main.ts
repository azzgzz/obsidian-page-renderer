import { Plugin, TFile, TFolder, Menu, MenuItem } from "obsidian";
import type { CliFlags, CliHandler } from "obsidian";
import { ExportSettings } from "@/types";
import { loadSettings, saveSettings } from "@/settings/settings";
import { DocumentExporterSettingTab } from "@/settings/settings-tab";
import { ExportModal, ExportModalResult } from "@/ui/ExportModal";
import { ExportRunner } from "@/export/ExportRunner";
import { runExport } from "@/runExport";
import { ProgressNotice } from "@/ui/ProgressNotice";
import { createProgressCallbacks } from "@/ui/exportProgress";
import { exportResultMessage } from "@/ui/ExportResultMessage";
import { CLI_COMMAND, CLI_DESCRIPTION, CLI_FLAGS, runCliExport } from "@/cli/CliExport";

type NotebookNavigatorMenus = {
	registerFileMenu?: (callback: (context: NotebookNavigatorFileContext) => void) => () => void;
	registerFolderMenu?: (callback: (context: NotebookNavigatorFolderContext) => void) => () => void;
};

type NotebookNavigatorFileContext = {
	selection?: { mode?: string };
	file?: unknown;
	addItem: (callback: (item: MenuItem) => void) => void;
};

type NotebookNavigatorFolderContext = {
	folder?: unknown;
	addItem: (callback: (item: MenuItem) => void) => void;
};

type CliCapablePlugin = {
	registerCliHandler?: (
		command: string,
		description: string,
		flags: CliFlags | null,
		handler: CliHandler,
	) => void;
};

type AppWithPluginRegistry = typeof Plugin.prototype.app & {
	plugins?: {
		plugins?: Record<string, unknown>;
	};
};

function isNotebookNavigatorMenus(value: unknown): value is NotebookNavigatorMenus {
	if (!value || typeof value !== "object") return false;
	const menus = value as NotebookNavigatorMenus;
	return (
		(typeof menus.registerFileMenu === "function" || typeof menus.registerFileMenu === "undefined")
		&& (typeof menus.registerFolderMenu === "function" || typeof menus.registerFolderMenu === "undefined")
	);
}

export default class DocumentExporterPlugin extends Plugin {
	settings!: ExportSettings;

	async onload() {
		this.settings = await loadSettings(this);

		// Ribbon icon
		this.addRibbonIcon("file-output", "Export documents", () => {
			this.openExportModal();
		});

		// Command palette
		this.addCommand({
			id: "export-documents",
			name: "Export documents",
			callback: () => this.openExportModal(),
		});

		// File explorer context menu — right-click on file
		this.registerEvent(
			this.app.workspace.on("file-menu", (menu: Menu, file) => {
				if (file instanceof TFile && file.extension === "md") {
					menu.addItem((item) => {
						item.setTitle("Export this file")
							.setIcon("file-output")
							.onClick(() => this.openExportModal(file, undefined));
					});
				}
				if (file instanceof TFolder) {
					menu.addItem((item) => {
						item.setTitle("Export this folder")
							.setIcon("file-output")
							.onClick(() => this.openExportModal(undefined, file));
					});
				}
			}),
		);

		// Editor context menu — right-click in editor
		this.registerEvent(
			this.app.workspace.on("editor-menu", (menu: Menu) => {
				menu.addItem((item) => {
					item.setTitle("azz-export")
						.setIcon("file-output")
						.onClick(() => this.openExportModal());
				});
			}),
		);

		// Notebook Navigator context menu integration
		this.registerNotebookNavigatorMenus();

		this.registerCliCommand();

		this.addSettingTab(new DocumentExporterSettingTab(this.app, this));
	}

	onunload() {}

	private registerCliCommand() {
		// registerCliHandler exists since Obsidian 1.12.2; older versions keep UI-only export,
		// so the API is feature-detected instead of raising minAppVersion.
		const host = this as unknown as CliCapablePlugin;
		if (typeof host.registerCliHandler !== "function") return;
		try {
			host.registerCliHandler(
				CLI_COMMAND,
				CLI_DESCRIPTION,
				CLI_FLAGS,
				(params) => runCliExport(this.app, this.settings, params),
			);
		} catch (err) {
			console.error("Document Exporter: failed to register CLI command", err);
		}
	}

	private registerNotebookNavigatorMenus() {
		const nnMenus = this.getNotebookNavigatorMenus();
		if (!nnMenus) return;

		if (typeof nnMenus.registerFileMenu === "function") {
			const dispose = nnMenus.registerFileMenu((context) => {
				if (context.selection?.mode !== "single") return;
				const file = context.file;
				if (!(file instanceof TFile) || file.extension !== "md") return;
				context.addItem((item) => {
					item.setTitle("Export this file")
						.setIcon("file-output")
						.onClick(() => this.openExportModal(file, undefined));
				});
			});
			this.register(() => dispose());
		}

		if (typeof nnMenus.registerFolderMenu === "function") {
			const dispose = nnMenus.registerFolderMenu((context) => {
				const folder = context.folder;
				if (!(folder instanceof TFolder)) return;
				context.addItem((item) => {
					item.setTitle("Export this folder")
						.setIcon("file-output")
						.onClick(() => this.openExportModal(undefined, folder));
				});
			});
			this.register(() => dispose());
		}
	}

	private getNotebookNavigatorMenus(): NotebookNavigatorMenus | null {
		const app = this.app as AppWithPluginRegistry;
		const registry = app.plugins?.plugins;
		if (!registry) return null;

		const notebookNavigator = registry["notebook-navigator"];
		if (!notebookNavigator || typeof notebookNavigator !== "object") return null;

		const api = (notebookNavigator as { api?: unknown }).api;
		if (!api || typeof api !== "object") return null;

		const menus = (api as { menus?: unknown }).menus;
		if (!isNotebookNavigatorMenus(menus)) return null;

		return menus;
	}

	async saveSettings() {
		await saveSettings(this, this.settings);
	}

	private openExportModal(preselectedFile?: TFile, preselectedFolder?: TFolder) {
		const modal = new ExportModal(this.app, this.settings, preselectedFile, preselectedFolder);
		void modal.openForResult().then((result) => {
			if (result) void this.executeExport(result);
		});
	}

	private async executeExport(result: ExportModalResult) {
		const progress = new ProgressNotice(this.buildProgressTitle(result));
		const runner = new ExportRunner(this.app);
		progress.onCancel = () => runner.cancel();

		try {
			const outcome = await runExport(this.app, this.settings, {
				source: result.source,
				outputFolder: result.outputFolder,
				outputFilename: result.outputFilename,
				outputFolderName: result.outputFolderName,
			}, { runner, callbacks: createProgressCallbacks(progress) });
			progress.finish(
				outcome.ok ? exportResultMessage(outcome.result) : `Export failed: ${outcome.error}`,
			);
		} catch (err) {
			const message = err instanceof Error ? err.message : String(err);
			progress.finish(`Export error: ${message}`);
		}
	}

	private buildProgressTitle(result: ExportModalResult): string {
		switch (result.source.type) {
			case "current-file": {
				const name = result.source.path.split("/").pop()?.replace(/\.md$/, "") ?? "file";
				return `Exporting: ${name}`;
			}
			case "folder": {
				const name = result.source.path.split("/").pop() ?? "folder";
				return `Exporting folder: ${name}`;
			}
			case "files":
				return `Exporting ${result.source.paths.length} files`;
		}
	}
}
