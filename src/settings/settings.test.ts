import { describe, expect, it, vi } from "vitest";
import { loadSettings, saveSettings } from "@/settings/settings";
import { DEFAULT_SETTINGS } from "@/types";

function makePlugin(stored: unknown) {
	return {
		loadData: vi.fn().mockResolvedValue(stored),
		saveData: vi.fn().mockResolvedValue(undefined),
	};
}

describe("loadSettings", () => {
	it("returns the defaults when nothing is stored", async () => {
		const settings = await loadSettings(makePlugin(null) as never);
		expect(settings).toEqual(DEFAULT_SETTINGS);
	});

	it("keeps stored values and fills in missing ones", async () => {
		const settings = await loadSettings(
			makePlugin({ defaultOutputFolder: "export", overwriteExisting: true }) as never,
		);
		expect(settings).toEqual({
			...DEFAULT_SETTINGS,
			defaultOutputFolder: "export",
			overwriteExisting: true,
		});
	});

	it.each(["pdf", "docx", "epub", "html-document", "markdown-bundle", "markdown-rendered"])(
		"drops the stale defaultProfile=%s from earlier versions",
		async (defaultProfile) => {
			const settings = await loadSettings(
				makePlugin({ defaultProfile, defaultOutputFolder: "export" }) as never,
			);
			expect(settings).not.toHaveProperty("defaultProfile");
			expect(settings.defaultOutputFolder).toBe("export");
		},
	);

	it("does not write the stale key back on save", async () => {
		const plugin = makePlugin({ defaultProfile: "pdf" });
		const settings = await loadSettings(plugin as never);
		await saveSettings(plugin as never, settings);
		expect(plugin.saveData).toHaveBeenCalledWith(DEFAULT_SETTINGS);
	});
});
