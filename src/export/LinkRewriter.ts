import { App } from "obsidian";
import { AttachmentCopy } from "@/types";
import {
	normalizePath, extractCodeBlocks, restoreCodeBlocks, relativePathBetween, wikiEmbedRe,
} from "@/export/utils";

const WIKI_LINK_RE = /\[\[([^\]]+)]]/g;
const MARKDOWN_INLINE_LINK_RE =
	/(!?)\[([^\]]*)\]\(\s*(<[^>]+>|[^)\s]+)(\s+(?:"[^"]*"|'[^']*'|\([^)]*\)))?\s*\)/g;
// Inside table cells a wiki link alias separator is written as "\|".
const WIKI_ALIAS_SEPARATOR_RE = /\\?\|/;
const EMBED_PLACEHOLDER = "\uE000WE";

export interface RewriteResult {
	markdown: string;
	warnings: string[];
}

export class LinkRewriter {
	private app: App;
	private exportedPaths: Set<string>;
	private attachments: Map<string, AttachmentCopy>;
	private outputRoot: string;
	private outputPathMap: Map<string, string>;
	private currentOutputPath: string;

	constructor(
		app: App,
		exportedPaths: Set<string>,
		attachments: AttachmentCopy[],
		outputPathMap: Map<string, string> = new Map(),
		currentOutputPath: string = "",
		outputRoot: string = "",
	) {
		this.app = app;
		this.exportedPaths = exportedPaths;
		this.attachments = new Map(
			attachments.map((a) => [a.sourcePath, a]),
		);
		this.outputPathMap = outputPathMap;
		this.currentOutputPath = currentOutputPath;
		this.outputRoot = outputRoot;
	}

	rewrite(markdown: string, sourcePath: string): RewriteResult {
		const warnings: string[] = [];

		const { text, blocks } = extractCodeBlocks(markdown);
		const embedReplacements: string[] = [];

		// Protect every embed result from the later wiki and Markdown link passes.
		let result = text.replace(wikiEmbedRe(), (match, link: string) => {
			const [rawTarget, alias] = link.split(WIKI_ALIAS_SEPARATOR_RE);
			const [target, heading] = rawTarget.split("#");
			const displayText = alias || target;
			const dest = this.resolvePath(target, sourcePath);
			if (!dest) {
				warnings.push(`Unresolved embed: ${target}`);
				return storeReplacement(embedReplacements, match);
			}

			const attachment = this.attachments.get(dest);
			if (attachment) {
				const relPath = this.rewriteAttachmentPath(attachment.outputRelativePath);
				// An empty alt (![](path)) is not rendered as an image by Obsidian
				// and many Markdown viewers, so the link text serves as alt.
				return storeReplacement(embedReplacements, `![${target}](${relPath})`);
			}

			if (this.exportedPaths.has(dest)) {
				return storeReplacement(
					embedReplacements,
					this.formatExportedNoteLink(dest, displayText, target, heading),
				);
			}

			if (dest.toLowerCase().endsWith(".md")) {
				return storeReplacement(embedReplacements, `[[${link}]]`);
			}

			warnings.push(`Unresolved embed: ${target}`);
			return storeReplacement(embedReplacements, match);
		});

		// Rewrite standard inline links and images before generating Markdown
		// links from wiki syntax, so generated output is not processed twice.
		result = result.replace(
			MARKDOWN_INLINE_LINK_RE,
			(
				match,
				imagePrefix: string,
				label: string,
				hrefToken: string,
				titleSuffix = "",
			) => {
				const wrapped = hrefToken.startsWith("<") && hrefToken.endsWith(">");
				const href = wrapped ? hrefToken.slice(1, -1) : hrefToken;
				if (isExternalOrFragmentLink(href)) return match;

				const [target, heading] = href.split("#");
				const dest = this.resolvePath(target, sourcePath);
				if (dest && this.exportedPaths.has(dest)) {
					const destination = this.exportedNoteDestination(
						dest,
						target,
						heading,
					);
					return `${imagePrefix}[${label}](${destination}${titleSuffix})`;
				}

				const relativeDest = this.resolveRelativePath(target, sourcePath);
				const attachmentDest = dest && this.attachments.has(dest)
					? dest
					: relativeDest;
				const attachment = attachmentDest
					? this.attachments.get(attachmentDest)
					: undefined;
				if (attachment) {
					const rewrittenPath = this.rewriteAttachmentPath(
						attachment.outputRelativePath,
					);
					return `${imagePrefix}[${label}](${rewrittenPath}${titleSuffix})`;
				}

				warnings.push(`Unresolved local link: ${href}`);
				return match;
			},
		);

		// Rewrite wiki links: [[Note]] or [[Note|Alias]]
		result = result.replace(WIKI_LINK_RE, (match, link: string) => {
			const [rawTarget, alias] = link.split(WIKI_ALIAS_SEPARATOR_RE);
			const [target, heading] = rawTarget.split("#");
			const displayText = alias || target;

			const dest = this.resolvePath(target, sourcePath);
			if (!dest) {
				warnings.push(`Unresolved link: ${target}`);
				return displayText;
			}

			if (this.exportedPaths.has(dest)) {
				return this.formatExportedNoteLink(dest, displayText, target, heading);
			}

			const attachment = this.attachments.get(dest);
			if (attachment) {
				return `[${displayText}](${this.rewriteAttachmentPath(attachment.outputRelativePath)})`;
			}

			// The note stays in the vault; a link that opens it there beats plain text.
			return this.formatVaultLink(dest, displayText, heading);
		});

		result = restoreReplacements(result, embedReplacements);
		result = restoreCodeBlocks(result, blocks);

		return { markdown: result, warnings };
	}

	private resolvePath(link: string, sourcePath: string): string | null {
		const dest = this.app.metadataCache.getFirstLinkpathDest(
			link,
			sourcePath,
		);
		return dest?.path ?? null;
	}

	private resolveRelativePath(href: string, sourcePath: string): string | null {
		const dir = sourcePath.includes("/")
			? sourcePath.substring(0, sourcePath.lastIndexOf("/"))
			: "";
		const resolved = dir ? `${dir}/${href}` : href;
		const normalized = normalizePath(resolved);
		const file = this.app.vault.getAbstractFileByPath(normalized);
		return file ? normalized : null;
	}

	private formatExportedNoteLink(
		dest: string,
		displayText: string,
		target: string,
		heading?: string,
	): string {
		return `[${displayText}](${this.exportedNoteDestination(dest, target, heading)})`;
	}

	// A plain Markdown link with the path from the vault root; the file stays in
	// the vault, so the link opens it there.
	private formatVaultLink(
		dest: string,
		displayText: string,
		heading?: string,
	): string {
		const fragment = heading ? `#${encodeLinkDestination(heading)}` : "";
		return `[${displayText}](${encodeLinkDestination(dest)}${fragment})`;
	}

	private exportedNoteDestination(
		dest: string,
		target: string,
		heading?: string,
	): string {
		const targetOutput = this.outputPathMap.get(dest);
		if (targetOutput && this.currentOutputPath) {
			const relPath = relativePathBetween(this.currentOutputPath, targetOutput);
			const hash = heading ? `#${slugify(heading)}` : "";
			return `${relPath}${hash}`;
		}

		return heading
			? `#${slugify(target)}-${slugify(heading)}`
			: `#${slugify(target)}`;
	}

	private rewriteAttachmentPath(attRelativePath: string): string {
		if (!this.currentOutputPath || !this.outputRoot) return attRelativePath;
		// attRelativePath is relative to outputRoot (e.g., "assets/image.png")
		// currentOutputPath is e.g., "exports/a/note1.md", outputRoot is "exports"
		// We need the relative path from the output file's directory to the attachment
		const dirAfterRoot = this.currentOutputPath.startsWith(this.outputRoot + "/")
			? this.currentOutputPath.slice(this.outputRoot.length + 1)
			: this.currentOutputPath;
		const depth = dirAfterRoot.split("/").length - 1; // -1 for the filename
		if (depth <= 0) return attRelativePath;
		return "../".repeat(depth) + attRelativePath;
	}
}

// Escapes what would end or break a Markdown link destination; non-ASCII text
// and slashes stay readable.
function encodeLinkDestination(value: string): string {
	return value.replace(
		/[ %#?()<>[\]"\\|`{}]/g,
		(ch) => `%${ch.charCodeAt(0).toString(16).toUpperCase().padStart(2, "0")}`,
	);
}

function storeReplacement(values: string[], value: string): string {
	values.push(value);
	return `${EMBED_PLACEHOLDER}${values.length - 1}${EMBED_PLACEHOLDER}`;
}

function restoreReplacements(text: string, values: string[]): string {
	return text.replace(
		new RegExp(`${EMBED_PLACEHOLDER}(\\d+)${EMBED_PLACEHOLDER}`, "g"),
		(_match, index: string) => values[Number(index)],
	);
}

function isExternalOrFragmentLink(href: string): boolean {
	return /^(?:https?:|mailto:|data:|#)/i.test(href);
}

export function slugify(text: string): string {
	return text
		.toLowerCase()
		.replace(/\s+/g, "-")
		.replace(/[^a-z0-9一-鿿぀-ゟ゠-ヿ가-힯_-]+/g, "")
		.replace(/-+/g, "-")
		.replace(/^-|-$/g, "");
}
