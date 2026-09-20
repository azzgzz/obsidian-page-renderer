import { App, Modal, Platform, TFile, TFolder } from "obsidian";
import { ExportSettings, ExportSource } from "@/types";
import { FilePickerModal } from "@/ui/FilePickerModal";
import { FolderPickerModal } from "@/ui/FolderPickerModal";
import { pickSystemFolder } from "@/ui/systemFolderPicker";

const SOURCE_OPTIONS = {
	"current-file": "Current file",
	folder: "Folder",
	files: "Selected files",
} as const;

type SourceType = keyof typeof SOURCE_OPTIONS;

export type ExportModalResult = {
	source: ExportSource;
	outputFolder: string;
	outputFilename: string;
	outputFolderName?: string;
};

export function deriveDefaultFilename(
	app: App,
	preselectedFile?: TFile,
	preselectedFolder?: TFolder,
): string {
	if (preselectedFile) return preselectedFile.basename;
	if (preselectedFolder) return preselectedFolder.name;
	return app.workspace.getActiveFile()?.basename ?? "export";
}

export class ExportModal extends Modal {
	private settings: ExportSettings;
	private resolve: ((result: ExportModalResult | null) => void) | null = null;
	private sourceType: SourceType = "current-file";
	private folderPath = "";
	private selectedFilePaths: string[] = [];
	private outputFolder: string;
	private outputFilename: string;
	private outputFolderName = "";
	private preselectedFile?: TFile;
	private preselectedFolder?: TFolder;

	constructor(app: App, settings: ExportSettings, preselectedFile?: TFile, preselectedFolder?: TFolder) {
		super(app);
		this.settings = settings;
		this.preselectedFile = preselectedFile;
		this.preselectedFolder = preselectedFolder;
		this.outputFolder = settings.defaultOutputFolder;
		this.outputFilename = deriveDefaultFilename(
			app,
			preselectedFile,
			preselectedFolder,
		);
	}

	onOpen(): void {
		if (this.preselectedFile) {
			this.sourceType = "current-file";
		} else if (this.preselectedFolder) {
			this.sourceType = "folder";
			this.folderPath = this.preselectedFolder.path;
		}
		this.renderForm();
	}

	onClose(): void {
		this.contentEl.empty();
		this.resolve?.(null);
		this.resolve = null;
	}

	openForResult(): Promise<ExportModalResult | null> {
		return new Promise((resolve) => {
			this.resolve = resolve;
			this.open();
		});
	}

	private renderForm(): void {
		const { contentEl } = this;
		contentEl.empty();
		contentEl.createEl("h2", { text: "Export documents" });

		// Source type
		const sourceRow = contentEl.createDiv({ cls: "export-modal-row" });
		sourceRow.createEl("label", { text: "Source" });
		const sourceSelect = sourceRow.createEl("select");
		for (const [value, label] of Object.entries(SOURCE_OPTIONS)) {
			const opt = sourceSelect.createEl("option", { text: label });
			opt.value = value;
		}
		sourceSelect.value = this.sourceType;

		const sourceFields = contentEl.createDiv({ cls: "export-modal-source-fields" });

		const renderSourceFields = () => {
			sourceFields.empty();
			if (this.sourceType === "folder") {
				sourceFields.removeClass("export-modal-source-fields");
				this.renderFolderPicker(sourceFields, "Folder path", this.folderPath, (v) => {
					this.folderPath = v;
					renderNameField();
				});
			} else if (this.sourceType === "files") {
				sourceFields.addClass("export-modal-source-fields");
				const count = this.selectedFilePaths.length;
				const btn = sourceFields.createEl("button", {
					text: count > 0 ? `${count} file(s) selected` : "Choose files",
				});
				btn.addEventListener("click", () => {
					const picker = new FilePickerModal(this.app, this.selectedFilePaths, (paths) => {
						this.selectedFilePaths = paths;
						btn.textContent = paths.length > 0 ? `${paths.length} file(s) selected` : "Choose files";
					});
					picker.open();
				});
			} else {
				sourceFields.removeClass("export-modal-source-fields");
			}
		};

		sourceSelect.addEventListener("change", () => {
			this.sourceType = sourceSelect.value as SourceType;
			renderSourceFields();
			renderNameField();
			updateDefaultFilename();
		});
		renderSourceFields();

		// Output folder with browser — supports both vault and system paths
		this.renderOutputFolderPicker(contentEl);

		// Output name field (File name for single, Folder name for batch)
		const nameFieldContainer = contentEl.createDiv();
		let filenameInput: HTMLInputElement | null = null;

		const renderNameField = () => {
			nameFieldContainer.empty();
			const isBatch = this.sourceType !== "current-file";
			const row = nameFieldContainer.createDiv({ cls: "export-modal-row" });

			if (isBatch) {
				this.updateDefaultFolderName();
				row.createEl("label", { text: "Folder name" });
				const input = row.createEl("input", {
					type: "text",
					attr: { placeholder: this.sourceType === "folder" ? "folder name" : "files" },
				});
				input.value = this.outputFolderName;
				input.addEventListener("input", (e) => {
					this.outputFolderName = (e.target as HTMLInputElement).value;
				});
				filenameInput = null;
			} else {
				row.createEl("label", { text: "File name" });
				const input = row.createEl("input", {
					type: "text",
					attr: { placeholder: "Document" },
				});
				input.value = this.outputFilename;
				input.addEventListener("input", (e) => {
					this.outputFilename = (e.target as HTMLInputElement).value;
				});
				filenameInput = input;
			}
		};
		renderNameField();

		const updateDefaultFilename = () => {
			if (this.sourceType === "current-file") {
				const file = this.preselectedFile ?? this.app.workspace.getActiveFile();
				this.outputFilename = file?.basename ?? "export";
				if (filenameInput) filenameInput.value = this.outputFilename;
			}
		};

		// Buttons
		const buttonRow = contentEl.createDiv({ cls: "export-modal-buttons" });
		const cancelButton = buttonRow.createEl("button", { text: "Cancel" });
		cancelButton.addEventListener("click", () => {
			this.resolve = null;
			this.close();
		});
		const exportButton = buttonRow.createEl("button", { text: "Next", cls: "mod-cta" });
		exportButton.addEventListener("click", () => {
			const result = this.buildResult();
			this.renderConfirmation(result);
		});
	}

	private renderFolderPicker(
		container: HTMLElement,
		label: string,
		currentValue: string,
		onChange: (value: string) => void,
	): void {
		const row = container.createDiv({ cls: "export-modal-row" });
		row.createEl("label", { text: label });
		const group = row.createDiv({ cls: "export-modal-input-group" });
		const input = group.createEl("input", { type: "text" });
		input.value = currentValue;
		input.addEventListener("input", (e) => {
			onChange((e.target as HTMLInputElement).value);
		});
		const browseBtn = group.createEl("button", { text: "Browse", cls: "export-modal-browse-btn" });
		browseBtn.addEventListener("click", () => {
			const picker = new FolderPickerModal(this.app, (selected) => {
				input.value = selected;
				onChange(selected);
			});
			picker.open();
		});
	}

	private renderOutputFolderPicker(container: HTMLElement): void {
		const onChange = (v: string) => { this.outputFolder = v; };

		const row = container.createDiv({ cls: "export-modal-row" });
		row.createEl("label", { text: "Output folder" });
		const group = row.createDiv({ cls: "export-modal-input-group" });
		const input = group.createEl("input", {
			type: "text",
			attr: { placeholder: Platform.isDesktopApp
				? "exports or /users/you/desktop/exports"
				: "exports (vault-relative only)" },
		});
		input.value = this.outputFolder;
		input.addEventListener("input", (e) => {
			onChange((e.target as HTMLInputElement).value);
		});

		// Vault folder picker
		const vaultBtn = group.createEl("button", { text: "Vault", cls: "export-modal-browse-btn" });
		vaultBtn.addEventListener("click", () => {
			const picker = new FolderPickerModal(this.app, (selected) => {
				input.value = selected;
				onChange(selected);
			});
			picker.open();
		});

		// System folder picker (desktop only)
		if (Platform.isDesktopApp) {
			const sysBtn = group.createEl("button", { text: "Choose folder", cls: "export-modal-browse-btn" });
			sysBtn.addEventListener("click", () => {
				void (async () => {
					try {
						const folder = await pickSystemFolder();
						if (folder) {
							input.value = folder;
							onChange(folder);
						}
					} catch (err) {
						console.error("Page Renderer: failed to open folder dialog", err);
					}
				})();
			});
		}
	}

	private renderConfirmation(result: ExportModalResult): void {
		const { contentEl } = this;
		contentEl.empty();
		contentEl.createEl("h2", { text: "Confirm export" });

		const summary = contentEl.createDiv({ cls: "export-confirm-summary" });
		const isSingleFile = result.source.type === "current-file";
		if (isSingleFile) {
			summary.createEl("p", { text: `Output: ${result.outputFolder}/${result.outputFilename}` });
		} else {
			const folderName = result.outputFolderName ?? "export";
			summary.createEl("p", { text: `Output: ${result.outputFolder}/${folderName}/ (preserving directory structure)` });
		}

		summary.createEl("p", { text: `Source: ${SOURCE_OPTIONS[result.source.type]}` });

		if (result.source.type === "folder") {
			summary.createEl("p", { text: `Folder: ${result.source.path}` });
		}

		const buttonRow = contentEl.createDiv({ cls: "export-modal-buttons" });
		const backButton = buttonRow.createEl("button", { text: "Back" });
		backButton.addEventListener("click", () => {
			this.renderForm();
		});
		const confirmButton = buttonRow.createEl("button", { text: "Export", cls: "mod-cta" });
		confirmButton.addEventListener("click", () => {
			const resolveRef = this.resolve;
			this.resolve = null;
			this.close();
			resolveRef?.(result);
		});
	}

	private updateDefaultFolderName(): void {
		if (this.sourceType === "folder" && this.folderPath) {
			this.outputFolderName = this.folderPath.split("/").pop() ?? "files";
		} else {
			this.outputFolderName = "files";
		}
	}

	private buildSource(): ExportSource {
		switch (this.sourceType) {
			case "current-file": {
				const file = this.preselectedFile ?? this.app.workspace.getActiveFile();
				return { type: "current-file", path: file?.path ?? "" };
			}
			case "folder":
				return { type: "folder", path: this.folderPath };
			case "files":
				return { type: "files", paths: [...this.selectedFilePaths] };
		}
	}

	private buildResult(): ExportModalResult {
		const isBatch = this.sourceType !== "current-file";
		return {
			source: this.buildSource(),
			outputFolder: this.outputFolder,
			outputFilename: this.outputFilename || "export",
			outputFolderName: isBatch ? (this.outputFolderName || "files") : undefined,
		};
	}
}
