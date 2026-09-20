import { PluginSettingTab, App, Setting, debounce } from "obsidian";
import type { SettingDefinition, SettingDefinitionItem } from "obsidian";
import { DEFAULT_SETTINGS, ExportSettings } from "@/types";
import type PageRendererPlugin from "@/main";

type SettingSpec = {
	key: keyof ExportSettings;
	type: "text" | "toggle";
	name: string;
	desc: string;
	/** Extra search terms for settings search (Obsidian 1.13+). */
	aliases: string[];
	placeholder?: string;
	/** Listed under the "Advanced" heading. */
	advanced?: boolean;
};

// Single source of truth for the settings: getSettingDefinitions() exposes it
// to Obsidian 1.13+, display() renders the same list for older versions.
const SETTINGS: SettingSpec[] = [
	{
		key: "defaultOutputFolder",
		type: "text",
		name: "Output folder",
		desc: "Exported files will be saved here (relative to vault root). You can change this path to any folder in your vault.",
		aliases: ["directory", "destination", "save location", "export path"],
		placeholder: "exports",
	},
	{
		key: "expandEmbeds",
		type: "toggle",
		name: "Expand note embeds",
		desc: "Inline ![[Note]] embeds into the exported document instead of keeping them as links.",
		aliases: ["transclusion", "include notes", "inline"],
	},
	{
		key: "includeSourcePathComments",
		type: "toggle",
		name: "Include source path comments",
		desc: "Add an HTML comment with the path of the source note under the title.",
		aliases: ["origin", "provenance"],
		advanced: true,
	},
	{
		key: "includeProperties",
		type: "toggle",
		name: "Include properties",
		desc: "Keep the note's properties (YAML frontmatter) at the top of the exported file.",
		aliases: ["frontmatter", "yaml", "metadata", "header", "mdr"],
		advanced: true,
	},
	{
		key: "copyAttachments",
		type: "toggle",
		name: "Copy attachments",
		desc: "Copy referenced images and files into the export bundle.",
		aliases: ["images", "assets", "media"],
		advanced: true,
	},
	{
		key: "overwriteExisting",
		type: "toggle",
		name: "Overwrite existing exports",
		desc: "Replace existing export files when enabled. When disabled and the destination already exists, the export uses a new timestamped folder for its documents, attachments and report.",
		aliases: ["replace", "timestamped folder"],
		advanced: true,
	},
];

const TEXT_SAVE_DELAY_MS = 500;

export class PageRendererSettingTab extends PluginSettingTab {
	plugin: PageRendererPlugin;

	// A text field would otherwise write data.json on every keystroke.
	private saveSoon = debounce(() => {
		void this.plugin.saveSettings();
	}, TEXT_SAVE_DELAY_MS, true);

	constructor(app: App, plugin: PageRendererPlugin) {
		super(app, plugin);
		this.plugin = plugin;
	}

	getSettingDefinitions(): SettingDefinitionItem[] {
		const toDefinition = (spec: SettingSpec): SettingDefinition => ({
			name: spec.name,
			desc: spec.desc,
			aliases: [...spec.aliases],
			control: spec.type === "text"
				? {
					type: "text",
					key: spec.key,
					defaultValue: DEFAULT_SETTINGS[spec.key] as string,
					placeholder: spec.placeholder,
				}
				: {
					type: "toggle",
					key: spec.key,
					defaultValue: DEFAULT_SETTINGS[spec.key] as boolean,
				},
		});

		return [
			...SETTINGS.filter((s) => !s.advanced).map(toDefinition),
			{
				type: "group",
				heading: "Advanced",
				items: SETTINGS.filter((s) => s.advanced).map(toDefinition),
			},
		];
	}

	getControlValue(key: string): unknown {
		return (this.plugin.settings as Record<string, unknown>)[key];
	}

	async setControlValue(key: string, value: unknown): Promise<void> {
		const spec = SETTINGS.find((s) => s.key === key);
		if (!spec) return;
		(this.plugin.settings as Record<string, unknown>)[key] = value;
		if (spec.type === "text") {
			this.saveSoon();
		} else {
			await this.plugin.saveSettings();
		}
	}

	display(): void {
		const { containerEl } = this;
		containerEl.empty();

		for (const spec of SETTINGS.filter((s) => !s.advanced)) this.renderSetting(spec);
		new Setting(containerEl).setName("Advanced").setHeading();
		for (const spec of SETTINGS.filter((s) => s.advanced)) this.renderSetting(spec);
	}

	private renderSetting(spec: SettingSpec): void {
		const setting = new Setting(this.containerEl).setName(spec.name).setDesc(spec.desc);
		const current = this.getControlValue(spec.key);

		if (spec.type === "text") {
			setting.addText((text) => {
				if (spec.placeholder) text.setPlaceholder(spec.placeholder);
				text.setValue(current as string);
				text.onChange((v) => void this.setControlValue(spec.key, v));
			});
		} else {
			setting.addToggle((toggle) => {
				toggle.setValue(current as boolean);
				toggle.onChange((v) => this.setControlValue(spec.key, v));
			});
		}
	}
}
