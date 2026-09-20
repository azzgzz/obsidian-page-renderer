type OpenDialogResult = { canceled: boolean; filePaths: string[] };
type Dialog = { showOpenDialog: (options: unknown) => Promise<OpenDialogResult> };
type ElectronModule = { remote?: { dialog?: Dialog }; dialog?: Dialog };

/**
 * Asks the operating system for a folder. Resolves to null when the user
 * cancels or when no native dialog exists (mobile).
 */
export async function pickSystemFolder(): Promise<string | null> {
	const g = typeof window !== "undefined" ? window : undefined;
	const electron = g && "require" in g
		? (g as unknown as Record<string, (id: string) => unknown>)["require"]("electron") as ElectronModule | undefined
		: undefined;
	const dialog = electron?.remote?.dialog ?? electron?.dialog;
	if (!dialog) return null;

	const result = await dialog.showOpenDialog({
		properties: ["openDirectory", "createDirectory"],
		title: "Select output folder",
	});
	return !result.canceled && result.filePaths[0] ? result.filePaths[0] : null;
}
