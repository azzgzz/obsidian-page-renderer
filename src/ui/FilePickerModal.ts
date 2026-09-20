import { App, Modal } from "obsidian";
import { collectMarkdownFiles } from "@/export/ExportSourceResolver";

/** Multi-select list of the vault's Markdown notes; reports the choice when closed. */
export class FilePickerModal extends Modal {
	private chosen: Set<string>;
	private onDone: (paths: string[]) => void;
	private filterText = "";
	private listEl: HTMLElement | null = null;

	constructor(app: App, currentPaths: string[], onDone: (paths: string[]) => void) {
		super(app);
		this.chosen = new Set(currentPaths);
		this.onDone = onDone;
	}

	onOpen(): void {
		const { contentEl } = this;
		contentEl.empty();
		contentEl.addClass("file-picker-modal");
		contentEl.createEl("h3", { text: "Select files" });

		const input = contentEl.createEl("input", {
			type: "text",
			cls: "file-picker-filter",
			attr: { placeholder: "Filter files..." },
		});
		input.addEventListener("input", () => {
			this.filterText = input.value.toLowerCase();
			this.renderList();
		});

		this.listEl = contentEl.createDiv({ cls: "file-picker-list" });
		this.renderList();

		const doneBtn = contentEl.createEl("button", { text: "Done", cls: "mod-cta file-picker-done-btn" });
		doneBtn.addEventListener("click", () => {
			this.close();
		});
	}

	onClose(): void {
		this.onDone(Array.from(this.chosen));
	}

	private renderList(): void {
		if (!this.listEl) return;
		this.listEl.empty();

		const allFiles = collectMarkdownFiles(this.app.vault.getRoot());
		const filtered = this.filterText
			? allFiles.filter((f) => f.path.toLowerCase().includes(this.filterText))
			: allFiles;
		filtered.sort((a, b) => a.path.localeCompare(b.path));

		for (const file of filtered) {
			const row = this.listEl.createDiv({ cls: "file-picker-item" });
			const label = row.createEl("label");
			const checkbox = label.createEl("input", { type: "checkbox" });
			checkbox.checked = this.chosen.has(file.path);
			checkbox.addEventListener("change", () => {
				if (checkbox.checked) {
					this.chosen.add(file.path);
				} else {
					this.chosen.delete(file.path);
				}
			});
			label.appendText(" " + file.path);
		}
	}
}
