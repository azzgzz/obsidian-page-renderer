import type { TAbstractFile, TFile, TFolder } from "obsidian";

export function normalizePath(p: string): string {
	const parts = p.split("/").filter(Boolean);
	const stack: string[] = [];
	for (const part of parts) {
		if (part === "..") { stack.pop(); }
		else if (part !== ".") { stack.push(part); }
	}
	return stack.join("/");
}

// Duck-typing instead of instanceof keeps modules testable without mocking obsidian.
export function isFile(f: TAbstractFile | null): f is TFile {
	return f !== null && "extension" in f;
}

export function isFolder(f: TAbstractFile | null): f is TFolder {
	return f !== null && "children" in f;
}

export function isMarkdown(f: TAbstractFile | null): f is TFile {
	return isFile(f) && f.extension === "md";
}

/**
 * A fresh `![[…]]` matcher per call: a shared `/g` regex keeps `lastIndex`
 * between calls and interleaves badly with async code.
 */
export function wikiEmbedRe(): RegExp {
	return /!\[\[([^\]]+)]]/g;
}

/** Absolute POSIX/Windows drive/UNC paths point outside the vault. */
export function isExternalPath(p: string): boolean {
	return p.startsWith("/") || p.startsWith("\\\\") || /^[A-Za-z]:[\\/]/.test(p);
}

export function timestampSuffix(): string {
	return new Date().toISOString().replace(/[:.]/g, "-").slice(0, 19);
}

export function timestampedFolder(basePath: string): string {
	return `${basePath}-${timestampSuffix()}`;
}

const CODE_BLOCK_PLACEHOLDER = "\x00CB";
const INLINE_CODE_PLACEHOLDER = "\x00IC";

// Fence matchers approximate CommonMark: a closing fence must repeat the
// opening marker (``` or ~~~, 3+ chars); unclosed fences fall through, and a
// closing fence longer than its opener with extra backticks/tildes is
// tolerated via the trailing character class.
const FENCE_BLOCK_RE = /(^|\n)(`{3,}|~{3,})[^\n]*\n[\s\S]*?\n\2[`~]*(?=\n|$)/g;
// Double-backtick spans are extracted first so a lone inner backtick (``a`b``)
// does not terminate them; single-backtick spans end at the next backtick.
const INLINE_DOUBLE_CODE_RE = /``((?:[^`\n]|`(?![`]))*?)``/g;
const INLINE_SINGLE_CODE_RE = /`([^`\n]+)`/g;

export function extractCodeBlocks(md: string): { text: string; blocks: string[] } {
	const blocks: string[] = [];
	let text = md.replace(FENCE_BLOCK_RE, (match) => {
		blocks.push(match);
		return `${CODE_BLOCK_PLACEHOLDER}${blocks.length - 1}${CODE_BLOCK_PLACEHOLDER}`;
	});
	text = text.replace(INLINE_DOUBLE_CODE_RE, (match) => {
		blocks.push(match);
		return `${INLINE_CODE_PLACEHOLDER}${blocks.length - 1}${INLINE_CODE_PLACEHOLDER}`;
	});
	text = text.replace(INLINE_SINGLE_CODE_RE, (match) => {
		blocks.push(match);
		return `${INLINE_CODE_PLACEHOLDER}${blocks.length - 1}${INLINE_CODE_PLACEHOLDER}`;
	});
	return { text, blocks };
}

export function restoreCodeBlocks(text: string, blocks: string[]): string {
	let result = text;
	result = result.replace(
		new RegExp(`${escapeRegex(INLINE_CODE_PLACEHOLDER)}(\\d+)${escapeRegex(INLINE_CODE_PLACEHOLDER)}`, "g"),
		(_, idx: string) => blocks[parseInt(idx)],
	);
	result = result.replace(
		new RegExp(`${escapeRegex(CODE_BLOCK_PLACEHOLDER)}(\\d+)${escapeRegex(CODE_BLOCK_PLACEHOLDER)}`, "g"),
		(_, idx: string) => blocks[parseInt(idx)],
	);
	return result;
}

function escapeRegex(s: string): string {
	return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

export function longestCommonDirPrefix(paths: string[]): string {
	if (paths.length === 0) return "";
	const split = paths.map(p => p.split("/"));
	const minLen = Math.min(...split.map(s => s.length));
	let commonLen = 0;
	for (let i = 0; i < minLen; i++) {
		const seg = split[0][i];
		if (split.every(s => s[i] === seg)) commonLen = i + 1;
		else break;
	}
	const dirPrefixLen = commonLen < minLen ? commonLen : commonLen - 1;
	if (dirPrefixLen === 0) return "";
	return split[0].slice(0, dirPrefixLen).join("/") + "/";
}

export function relativePathBetween(from: string, to: string): string {
	const fromParts = from.split("/");
	const toParts = to.split("/");

	// Find common prefix length (directory segments only, exclude filename)
	let commonLen = 0;
	while (commonLen < fromParts.length - 1 &&
		commonLen < toParts.length - 1 &&
		fromParts[commonLen] === toParts[commonLen]) {
		commonLen++;
	}

	const upCount = fromParts.length - commonLen - 1;
	const ups = upCount > 0 ? Array(upCount).fill("..").join("/") : "";
	const downParts = toParts.slice(commonLen).join("/");

	return ups ? `${ups}/${downParts}` : downParts;
}
