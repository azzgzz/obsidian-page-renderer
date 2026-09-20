import { describe, expect, it, vi } from "vitest";
import { DocumentExporterSettingTab } from "@/settings/settings-tab";
import { DEFAULT_SETTINGS, ExportSettings } from "@/types";

// The real debounce is timer based; capture the pending save so tests can fire it.
const debounced = vi.hoisted(() => ({ pending: null as (() => void) | null }));
vi.mock("obsidian", async (importOriginal) => ({
	...(await importOriginal<Record<string, unknown>>()),
	debounce: (callback: () => void) => () => {
		debounced.pending = callback;
	},
}));

function makePlugin(settings: ExportSettings = { ...DEFAULT_SETTINGS }) {
	return {
		settings,
		saveSettings: vi.fn().mockResolvedValue(undefined),
	};
}

function makeTab(plugin = makePlugin()) {
	return new DocumentExporterSettingTab({} as never, plugin as never);
}

describe("DocumentExporterSettingTab#getSettingDefinitions", () => {
	it("declares the output folder as a text control", () => {
		const defs = makeTab().getSettingDefinitions();
		const first = defs[0] as {
			name: string;
			control: { type: string; key: string; placeholder?: string };
		};
		expect(first.name).toBe("Output folder");
		expect(first.control.type).toBe("text");
		expect(first.control.key).toBe("defaultOutputFolder");
		expect(first.control.placeholder).toBe("Exports");
	});

	it("groups the advanced toggles under one heading", () => {
		const defs = makeTab().getSettingDefinitions();
		const expandEmbeds = defs[1] as { control: { type: string; key: string } };
		expect(expandEmbeds.control.type).toBe("toggle");
		expect(expandEmbeds.control.key).toBe("expandEmbeds");
		const group = defs[2] as {
			type: string;
			heading: string;
			items: { control: { type: string; key: string; defaultValue: boolean } }[];
		};
		expect(group.type).toBe("group");
		expect(group.heading).toBe("Advanced");
		expect(group.items.map((i) => i.control.key)).toEqual([
			"includeSourcePathComments",
			"includeProperties",
			"copyAttachments",
			"overwriteExisting",
		]);
		expect(group.items.every((i) => i.control.type === "toggle")).toBe(true);
	});

	it("adds search aliases to every setting", () => {
		const defs = makeTab().getSettingDefinitions();
		const flat = [
			defs[0],
			defs[1],
			...(defs[2] as { items: unknown[] }).items,
		] as { aliases?: string[] }[];
		expect(flat.every((d) => Array.isArray(d.aliases) && d.aliases.length > 0)).toBe(true);
	});
});

describe("DocumentExporterSettingTab control value bridge", () => {

	it("reads values from plugin settings", () => {
		const plugin = makePlugin({ ...DEFAULT_SETTINGS, overwriteExisting: true });
		const tab = makeTab(plugin);
		expect(tab.getControlValue("overwriteExisting")).toBe(true);
	});

	it("writes values and persists through saveSettings", async () => {
		const plugin = makePlugin();
		const tab = makeTab(plugin);
		await tab.setControlValue("copyAttachments", false);
		expect(plugin.settings.copyAttachments).toBe(false);
		expect(plugin.saveSettings).toHaveBeenCalledTimes(1);
	});

	it("applies a text value at once but saves it only when the debounce fires", async () => {
		const plugin = makePlugin();
		const tab = makeTab(plugin);

		await tab.setControlValue("defaultOutputFolder", "E");
		await tab.setControlValue("defaultOutputFolder", "Exp");

		expect(plugin.settings.defaultOutputFolder).toBe("Exp");
		expect(plugin.saveSettings).not.toHaveBeenCalled();
		debounced.pending?.();
		expect(plugin.saveSettings).toHaveBeenCalledTimes(1);
	});

	it("has no export format setting", async () => {
		const plugin = makePlugin();
		const tab = makeTab(plugin);
		const defs = tab.getSettingDefinitions() as { control?: { key: string } }[];
		expect(defs.some((d) => d.control?.key === "defaultProfile")).toBe(false);
		await tab.setControlValue("defaultProfile", "pdf");
		expect(plugin.saveSettings).not.toHaveBeenCalled();
	});

	it("ignores unknown keys", async () => {
		const plugin = makePlugin();
		const tab = makeTab(plugin);
		await tab.setControlValue("nope", 1);
		expect(plugin.saveSettings).not.toHaveBeenCalled();
	});
});
