import { App, TFile } from "obsidian";
import { ExportedNote, NoteFragment } from "@/types";
import { EmbedExpander } from "@/export/EmbedExpander";

export class DocumentAssembler {
	private app: App;
	private expandEmbeds: boolean;

	constructor(app: App, expandEmbeds = false) {
		this.app = app;
		this.expandEmbeds = expandEmbeds;
	}

	async assemble(file: TFile): Promise<ExportedNote> {
		const raw = await this.app.vault.read(file);
		const { body, frontmatter } = stripFrontmatter(raw);
		let title = deriveTitle(file, frontmatter);
		let contentBody = body;

		// Host title first: an embedded note's leading H1 must not hijack it.
		const extracted = extractLeadingH1(contentBody);
		if (extracted) {
			if (typeof frontmatter.title !== "string") {
				title = extracted.title;
				contentBody = extracted.remaining;
			} else if (extracted.title.trim() === frontmatter.title.trim()) {
				contentBody = extracted.remaining;
			}
		}

		let fragments: NoteFragment[] = [{
			markdown: contentBody,
			sourcePath: file.path,
		}];
		const warnings: string[] = [];
		let embeddedPaths: string[] = [];
		if (this.expandEmbeds) {
			const expanded = await new EmbedExpander(this.app).expand(contentBody, file.path);
			fragments = expanded.fragments;
			warnings.push(...expanded.warnings);
			embeddedPaths = expanded.embeddedPaths;
		}

		return {
			sourcePath: file.path,
			title,
			propertiesBlock: readPropertiesBlock(raw),
			fragments,
			warnings,
			embeddedPaths,
		};
	}
}

// Opening and closing fences with the YAML between them.
const FRONTMATTER_RE = /^---\r?\n((?:[\s\S]*?\r?\n)?)---(?:\r?\n|$)/;

/** The original properties block of a note, fences included, or null. */
export function readPropertiesBlock(content: string): string | null {
	const match = content.match(FRONTMATTER_RE);
	return match ? match[0].replace(/\r?\n$/, "") : null;
}

export function stripFrontmatter(
	content: string,
): { body: string; frontmatter: Record<string, unknown> } {
	const match = content.match(FRONTMATTER_RE);
	if (!match) {
		return { body: content, frontmatter: {} };
	}

	const yamlBlock = match[1].replace(/\r?\n$/, "");
	const body = content.slice(match[0].length);

	const frontmatter: Record<string, unknown> = {};
	for (const line of yamlBlock.split(/\r?\n/)) {
		if (/^\s/.test(line) || line.startsWith("-")) continue;
		const colonIndex = line.indexOf(":");
		if (colonIndex === -1) continue;
		const key = line.slice(0, colonIndex).trim();
		let value = line.slice(colonIndex + 1).trim();
		if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) {
			value = value.slice(1, -1);
		}
		frontmatter[key] = parseYamlValue(value);
	}

	return { body, frontmatter };
}

function parseYamlValue(value: string): unknown {
	if (value === "true") return true;
	if (value === "false") return false;
	if (value === "null" || value === "") return null;
	if (/^-?\d+$/.test(value)) return parseInt(value, 10);
	if (/^-?\d+\.\d+$/.test(value)) return parseFloat(value);
	return value;
}

export function deriveTitle(
	file: TFile,
	frontmatter: Record<string, unknown>,
): string {
	// Prefer an explicit frontmatter title; otherwise fall back to the file
	// basename. The body's leading H1 is handled separately by
	// extractLeadingH1 in buildSection so it can be removed from the body.
	if (typeof frontmatter.title === "string") {
		return frontmatter.title;
	}

	return file.basename;
}

/**
 * If the markdown body begins with a level-1 heading (`# Title`), extract that
 * heading's text as the document title and return the body with that line
 * removed. Returns null when the body does not start with an H1, so the caller
 * falls back to the filename-derived title.
 */
export function extractLeadingH1(
	body: string,
): { title: string; remaining: string } | null {
	const match = body.match(/^#\s+(.+?)\s*(?:\n|$)/);
	if (!match) return null;
	const title = match[1].trim();
	// Remove the matched H1 line (and its trailing newline) from the body.
	const remaining = body.slice(match[0].length);
	return { title, remaining };
}
