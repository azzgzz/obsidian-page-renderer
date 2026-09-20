import type { App } from "obsidian";
import { domToMarkdown } from "@/export/HtmlToMarkdown";
import { renderMarkdownDom } from "@/export/native-renderer";

export const QUERY_LANGUAGES: ReadonlySet<string> = new Set(["dataview", "dataviewjs", "tasks"]);

const RENDER_CONCURRENCY = 3;
const EMPTY_RESULT_MARKER = "-";

export type QueryRenderOutcome =
	| { ok: true; markdown: string }
	| { ok: false; reason: string };

/** Renders one fenced query block (source markdown incl. fences) into Markdown. */
export type QueryBlockRenderer = (
	blockMarkdown: string,
	sourcePath: string,
	language: string,
) => Promise<QueryRenderOutcome>;

export interface QueryResolution {
	markdown: string;
	warnings: string[];
}

type QueryBlock = {
	start: number;
	end: number;
	prefix: string;
	language: string;
	blockMarkdown: string;
};

// Opening fence with an optional container prefix: blockquote/callout markers
// and list indentation.
const FENCE_OPEN_RE = /^((?:[ \t]*>)*[ \t]*)(`{3,}|~{3,})[ \t]*([^\s`]*)/;
const CONTAINER_PREFIX_RE = /^(?:[ \t]*>)*[ \t]*/;
const BLANK_RE = /^[\s>]*$/;

function stripPrefix(line: string, prefix: string): string {
	if (line.startsWith(prefix)) return line.slice(prefix.length);
	return line.replace(prefix.includes(">") ? /^(?:[ \t]*>)+[ \t]?/ : /^[ \t]+/, "");
}

function isClosingFence(line: string, fence: string): boolean {
	const body = line.replace(CONTAINER_PREFIX_RE, "").trimEnd();
	return body.length >= fence.length && body.split("").every((ch) => ch === fence[0]);
}

function findQueryBlocks(lines: string[]): QueryBlock[] {
	const blocks: QueryBlock[] = [];
	let i = 0;
	while (i < lines.length) {
		const open = FENCE_OPEN_RE.exec(lines[i]);
		if (!open) {
			i++;
			continue;
		}
		const [, prefix, fence, info] = open;

		let end = -1;
		for (let j = i + 1; j < lines.length; j++) {
			if (isClosingFence(lines[j], fence)) {
				end = j;
				break;
			}
		}
		// An unclosed fence is not a block; keep scanning after the opener.
		if (end === -1) {
			i++;
			continue;
		}

		const language = info.toLowerCase();
		// Fences of any other language are skipped whole so example queries
		// inside them are left alone.
		if (QUERY_LANGUAGES.has(language)) {
			const body = lines.slice(i + 1, end).map((line) => stripPrefix(line, prefix));
			blocks.push({
				start: i,
				end,
				prefix,
				language,
				blockMarkdown: [`${fence}${info}`, ...body, fence].join("\n"),
			});
		}
		i = end + 1;
	}
	return blocks;
}

async function mapWithConcurrency<T, R>(
	items: T[],
	limit: number,
	task: (item: T) => Promise<R>,
): Promise<R[]> {
	const results = new Array<R>(items.length);
	let next = 0;
	const worker = async () => {
		while (next < items.length) {
			const index = next++;
			results[index] = await task(items[index]);
		}
	};
	await Promise.all(Array.from({ length: Math.min(limit, items.length) }, worker));
	return results;
}

/**
 * Replaces ```dataview / ```dataviewjs / ```tasks blocks with their rendered
 * results as Markdown. A block whose result cannot be obtained stays as
 * source and yields a warning. Without a renderer (no DOM available) all
 * blocks stay as source.
 */
export async function resolveQueryBlocks(
	markdown: string,
	sourcePath: string,
	render: QueryBlockRenderer | null,
): Promise<QueryResolution> {
	const lines = markdown.split("\n");
	const blocks = findQueryBlocks(lines);
	if (blocks.length === 0) return { markdown, warnings: [] };

	if (!render) {
		return {
			markdown,
			warnings: [
				`Query results in "${sourcePath}" were not rendered: no rendering environment available`,
			],
		};
	}

	const warnings: string[] = [];
	const outcomes = await mapWithConcurrency(blocks, RENDER_CONCURRENCY, async (block) => {
		try {
			return await render(block.blockMarkdown, sourcePath, block.language);
		} catch (err) {
			const reason = err instanceof Error ? err.message : String(err);
			return { ok: false as const, reason };
		}
	});

	const out: string[] = [];
	let cursor = 0;
	blocks.forEach((block, index) => {
		out.push(...lines.slice(cursor, block.start));
		cursor = block.end + 1;

		const outcome = outcomes[index];
		if (!outcome.ok) {
			warnings.push(
				`Query block not rendered in "${sourcePath}" (line ${block.start + 1}, ${block.language}): ${outcome.reason}`,
			);
			out.push(...lines.slice(block.start, block.end + 1));
			return;
		}

		const blank = block.prefix.trimEnd();
		// Rendered tables and lists must not glue onto the preceding paragraph.
		if (out.length > 0 && !BLANK_RE.test(out[out.length - 1])) out.push(blank);
		out.push(...outcome.markdown.split("\n").map((line) => (line ? `${block.prefix}${line}` : blank)));
		if (cursor < lines.length && !BLANK_RE.test(lines[cursor])) out.push(blank);
	});
	out.push(...lines.slice(cursor));

	return { markdown: out.join("\n"), warnings };
}

function hasLoadingPlaceholder(container: HTMLElement): boolean {
	// Tasks paints a bare "Loading Tasks ..." message, Dataview a
	// <pre class="dataview-error">Loading...</pre>.
	if ((container.textContent ?? "").trim().startsWith("Loading Tasks")) return true;
	return Array.from(container.querySelectorAll("pre.dataview-error"))
		.some((pre) => /^\s*Loading/i.test(pre.textContent ?? ""));
}

export function readQueryResult(container: HTMLElement, language: string): QueryRenderOutcome {
	if (hasLoadingPlaceholder(container)) {
		return { ok: false, reason: "the query did not finish rendering in time" };
	}

	const failure = Array.from(container.querySelectorAll("pre")).find((pre) => {
		return pre.classList.contains("dataview-error")
			|| /^\s*Tasks query:/.test(pre.textContent ?? "");
	});
	if (failure) {
		return { ok: false, reason: (failure.textContent ?? "").trim() || "the query reported an error" };
	}

	// Obsidian leaves the raw code block when no plugin claimed the language.
	if (container.querySelector(`code.language-${language}`)) {
		return { ok: false, reason: `no plugin rendered the ${language} block (installed and enabled?)` };
	}

	// A query that finished without failing and shows nothing has an empty
	// result (e.g. Tasks with `hide task count`); mark it instead of leaving source.
	return { ok: true, markdown: domToMarkdown(container) || EMPTY_RESULT_MARKER };
}

export function createNativeQueryRenderer(app: App): QueryBlockRenderer {
	return async (blockMarkdown, sourcePath, language) => {
		const { value } = await renderMarkdownDom(
			app,
			blockMarkdown,
			sourcePath,
			(container) => readQueryResult(container, language),
			{ isReady: (container) => !hasLoadingPlaceholder(container) },
		);
		return value;
	};
}
