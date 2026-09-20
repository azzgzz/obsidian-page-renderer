import { App, FuzzySuggestModal, TFolder } from "obsidian";
import { collectFolders } from "@/export/ExportSourceResolver";

/** Fuzzy search over the vault's folders; the vault root is reported as "". */
export class FolderPickerModal extends FuzzySuggestModal<TFolder> {
	private onSelect: (path: string) => void;

	constructor(app: App, onSelect: (path: string) => void) {
		super(app);
		this.onSelect = onSelect;
		this.setPlaceholder("Search folders...");
		this.setInstructions([{ command: "Enter", purpose: "Select folder" }]);
	}

	getItems(): TFolder[] {
		return collectFolders(this.app.vault.getRoot()).sort((a, b) => a.path.localeCompare(b.path));
	}

	getItemText(item: TFolder): string {
		return item.path === "/" ? "/ (vault root)" : item.path;
	}

	onChooseItem(item: TFolder): void {
		this.onSelect(item.path === "/" ? "" : item.path);
	}
}
