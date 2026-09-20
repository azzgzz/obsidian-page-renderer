// Converts the DOM that Dataview/Tasks render for query results into Markdown.
// Works on live nodes (not an innerHTML string) because checkbox state lives in
// the `checked` property, which serialization drops. Uses nodeType checks
// instead of instanceof so nodes from popout windows are handled too.

const ELEMENT_NODE = 1;
const TEXT_NODE = 3;

const HEADING_RE = /^h([1-6])$/;
const BLOCK_TAGS = new Set([
	"p", "div", "section", "article", "details", "summary", "ul", "ol", "table",
	"pre", "blockquote", "hr", "h1", "h2", "h3", "h4", "h5", "h6",
]);
const SKIPPED_TAGS = new Set(["script", "style", "template"]);
// Interactive Tasks controls and hidden block ids carry no exported information.
const SKIPPED_CLASSES = ["tasks-edit", "tasks-postpone", "task-block-link"];

export function domToMarkdown(root: Element): string {
	return renderBlocks(root).join("\n\n").trim();
}

function tagOf(node: Node): string {
	return node.nodeType === ELEMENT_NODE ? (node as Element).tagName.toLowerCase() : "";
}

function isSkipped(node: Node): boolean {
	if (node.nodeType !== ELEMENT_NODE) return false;
	const el = node as Element;
	if (SKIPPED_TAGS.has(tagOf(el))) return true;
	if (SKIPPED_CLASSES.some((cls) => el.classList.contains(cls))) return true;
	// Dataview's result counter inside table headers ("File" + "3").
	if (el.classList.contains("small-text") && el.closest("th") !== null) return true;
	return isHiddenTaskTag(el);
}

// Tasks keeps tags in the DOM and hides them with CSS when the query says
// `hide tags`; plain DOM reading has to honour that class itself.
function isHiddenTaskTag(el: Element): boolean {
	return el.classList.contains("tag")
		&& el.closest(".task-description") !== null
		&& el.closest(".tasks-layout-hide-tags") !== null;
}

function isBlock(node: Node): boolean {
	return BLOCK_TAGS.has(tagOf(node));
}

function renderBlocks(parent: Node): string[] {
	const blocks: string[] = [];
	let inline: Node[] = [];
	const flush = () => {
		const text = inlineText(inline, false).trim();
		if (text) blocks.push(text);
		inline = [];
	};

	for (const child of Array.from(parent.childNodes)) {
		if (isSkipped(child)) continue;
		if (isBlock(child)) {
			flush();
			const block = renderBlockElement(child as Element);
			if (block) blocks.push(block);
		} else {
			inline.push(child);
		}
	}
	flush();
	return blocks;
}

function renderBlockElement(el: Element): string {
	const tag = tagOf(el);
	const heading = HEADING_RE.exec(tag);
	if (heading) {
		const text = inlineText(Array.from(el.childNodes), false).trim();
		return text ? `${"#".repeat(Number(heading[1]))} ${text}` : "";
	}

	switch (tag) {
		case "p":
			return inlineText(Array.from(el.childNodes), false).trim();
		case "ul":
		case "ol":
			return renderList(el);
		case "table":
			return renderTable(el);
		case "pre":
			return renderCodeBlock(el);
		case "hr":
			return "---";
		case "blockquote":
			return renderBlocks(el)
				.join("\n\n")
				.split("\n")
				.map((line) => (line ? `> ${line}` : ">"))
				.join("\n");
		default:
			return renderBlocks(el).join("\n\n");
	}
}

function renderCodeBlock(el: Element): string {
	const code = (el.textContent ?? "").replace(/\n+$/, "");
	if (!code) return "";
	// A fence longer than any backtick run inside keeps the block intact.
	const longestRun = Math.max(0, ...(code.match(/`+/g) ?? []).map((run) => run.length));
	const fence = "`".repeat(Math.max(3, longestRun + 1));
	return `${fence}\n${code}\n${fence}`;
}

function taskSymbol(li: Element): string | null {
	const checkbox = Array.from(li.children).find((child) => {
		return tagOf(child) === "input" && (child as HTMLInputElement).type === "checkbox";
	}) as HTMLInputElement | undefined;
	if (!checkbox) return null;

	// `data-task` keeps custom statuses such as [/] or [-]; fall back to the
	// checkbox state when it is absent.
	const status = li.getAttribute("data-task");
	if (status && status.length === 1) return status;
	return checkbox.checked || li.classList.contains("is-checked") ? "x" : " ";
}

function renderList(list: Element): string {
	const ordered = tagOf(list) === "ol";
	let index = Number(list.getAttribute("start") ?? 1) || 1;
	const lines: string[] = [];

	for (const li of Array.from(list.children)) {
		if (tagOf(li) !== "li" || isSkipped(li)) continue;

		const marker = ordered ? `${index}. ` : "- ";
		const indent = " ".repeat(marker.length);
		const symbol = taskSymbol(li);
		const inline: Node[] = [];
		const nested: string[] = [];

		for (const child of Array.from(li.childNodes)) {
			if (isSkipped(child)) continue;
			const tag = tagOf(child);
			if (tag === "input") continue;
			if (tag === "p" || tag === "div") {
				// Loose-list paragraphs and wrappers read as part of the item text.
				inline.push(...Array.from(child.childNodes), li.ownerDocument.createTextNode(" "));
			} else if (isBlock(child)) {
				const block = renderBlockElement(child as Element);
				if (block) nested.push(block);
			} else {
				inline.push(child);
			}
		}

		const text = inlineText(inline, false).trim().replace(/\n/g, `\n${indent}`);
		if (!text && symbol === null && nested.length === 0) continue;

		const checkbox = symbol === null ? "" : `[${symbol}] `;
		lines.push(`${marker}${checkbox}${text}`.trimEnd());
		for (const block of nested) {
			lines.push(...block.split("\n").map((line) => (line ? `${indent}${line}` : line)));
		}
		index++;
	}
	return lines.join("\n");
}

function renderTable(table: Element): string {
	const grid = Array.from(table.querySelectorAll("tr")).map((row) => {
		return Array.from(row.children)
			.filter((cell) => tagOf(cell) === "td" || tagOf(cell) === "th")
			.map((cell) => cellText(cell));
	}).filter((row) => row.length > 0);
	if (grid.length === 0) return "";

	const width = Math.max(...grid.map((row) => row.length));
	const padded = grid.map((row) => [...row, ...Array<string>(width - row.length).fill("")]);
	const format = (row: string[]) => `| ${row.join(" | ")} |`;

	return [
		format(padded[0]),
		format(Array<string>(width).fill("---")),
		...padded.slice(1).map(format),
	].join("\n");
}

function cellText(cell: Element): string {
	return inlineText(Array.from(cell.childNodes), true)
		.trim()
		.replace(/\s*\n\s*/g, "<br>")
		.replace(/\|/g, "\\|");
}

// Adjacent whitespace-only text nodes and padded blocks must not stack spaces.
function append(out: string, piece: string): string {
	return out.endsWith(" ") || out.endsWith("\n") ? out + piece.replace(/^ +/, "") : out + piece;
}

function inlineText(nodes: Node[], cell: boolean): string {
	let out = "";
	for (const node of nodes) {
		if (node.nodeType === TEXT_NODE) {
			out = append(out, (node.textContent ?? "").replace(/\s+/g, " "));
		} else if (node.nodeType === ELEMENT_NODE && !isSkipped(node)) {
			out = append(out, inlineElement(node as Element, cell));
		}
	}
	return out;
}

function wrap(marker: string, inner: string): string {
	const trimmed = inner.trim();
	return trimmed ? `${marker}${trimmed}${marker}` : "";
}

function inlineElement(el: Element, cell: boolean): string {
	const children = Array.from(el.childNodes);
	switch (tagOf(el)) {
		case "br":
			return cell ? "<br>" : "  \n";
		case "a":
			return anchor(el, cell);
		case "strong":
		case "b":
			return wrap("**", inlineText(children, cell));
		case "em":
		case "i":
			return wrap("*", inlineText(children, cell));
		case "del":
		case "s":
			return wrap("~~", inlineText(children, cell));
		case "code": {
			const code = el.textContent ?? "";
			return code ? `\`${code}\`` : "";
		}
		case "img":
			return el.getAttribute("alt") ?? "";
		case "input":
			return "";
		case "ul":
		case "ol": {
			// A list nested in a table cell or inline context is flattened.
			const items = Array.from(el.children)
				.filter((item) => tagOf(item) === "li" && !isSkipped(item))
				.map((item) => inlineText(Array.from(item.childNodes), cell).trim())
				.filter(Boolean);
			return items.join(cell ? "<br>" : ", ");
		}
		case "p":
		case "div":
			return ` ${inlineText(children, cell).trim()} `;
		default:
			return inlineText(children, cell);
	}
}

function anchor(el: Element, cell: boolean): string {
	const text = inlineText(Array.from(el.childNodes), cell).trim();
	if (el.classList.contains("tag")) return text;

	const target = el.getAttribute("data-href") ?? tasksBacklinkTarget(el, text);
	if (target) {
		return text && text !== target ? `[[${target}|${text}]]` : `[[${target}]]`;
	}

	const href = el.getAttribute("href");
	if (!href || href.startsWith("#") || !text) return text;
	return `[${text}](${href})`;
}

// Tasks draws its backlink as a bare anchor (no href) and opens the note from
// a click handler, so the only trace of the target is the label, which reads
// "File" or "File > Heading".
function tasksBacklinkTarget(el: Element, text: string): string | null {
	if (el.hasAttribute("href") || !el.closest(".tasks-backlink")) return null;
	// Short mode labels the link with an icon only; it carries no target.
	if (!text || text === "🔗" || /[[\]|]/.test(text)) return null;

	const [file, ...heading] = text.split(" > ");
	return heading.length > 0 ? `${file}#${heading.join(" > ")}` : file;
}
