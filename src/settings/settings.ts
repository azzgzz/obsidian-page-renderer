import { ExportSettings, DEFAULT_SETTINGS } from "@/types";
import { Plugin } from "obsidian";

export async function loadSettings(
	plugin: Plugin,
): Promise<ExportSettings> {
	const data = Object.assign({}, DEFAULT_SETTINGS, await plugin.loadData() as Partial<ExportSettings>);
	// The export format setting no longer exists; drop the stale key so it is not saved back.
	// One-off cleanup after the switch to Markdown-only export (1.0.0): remove once
	// installs upgraded past 1.0.0 have rewritten their data.json (e.g. in 1.1.0).
	delete (data as Record<string, unknown>).defaultProfile;
	return data;
}

export async function saveSettings(
	plugin: Plugin,
	settings: ExportSettings,
): Promise<void> {
	await plugin.saveData(settings);
}
