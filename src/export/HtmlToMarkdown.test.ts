/** @vitest-environment jsdom */
import { describe, expect, it } from "vitest";
import { domToMarkdown } from "@/export/HtmlToMarkdown";

function convert(html: string, prepare?: (root: HTMLElement) => void): string {
	const root = new DOMParser().parseFromString(html, "text/html").body;
	prepare?.(root);
	return domToMarkdown(root);
}

describe("domToMarkdown", () => {
	describe("Dataview", () => {
		it("converts a table and drops the result counter", () => {
			const md = convert(`
				<div class="block-language-dataview"><table class="dataview table-view-table">
					<thead class="table-view-thead"><tr class="table-view-tr-header">
						<th class="table-view-th">File<span class="dataview small-text">2</span></th>
						<th class="table-view-th">Status</th>
					</tr></thead>
					<tbody class="table-view-tbody">
						<tr><td><a class="internal-link" data-href="Projects/Alpha" href="Projects/Alpha">Alpha</a></td><td>open</td></tr>
						<tr><td><a class="internal-link" data-href="Beta" href="Beta">Beta</a></td><td>a | b</td></tr>
					</tbody>
				</table></div>`);
			expect(md).toBe([
				"| File | Status |",
				"| --- | --- |",
				// A pipe inside a table cell has to be escaped, wiki-link aliases included.
				"| [[Projects/Alpha\\|Alpha]] | open |",
				"| [[Beta]] | a \\| b |",
			].join("\n"));
		});

		it("flattens a list nested in a cell with <br>", () => {
			const md = convert(`<table><thead><tr><th>Tags</th></tr></thead><tbody><tr><td>
				<ul class="dataview dataview-ul dataview-result-list-ul"><li>a</li><li>b</li></ul></td></tr></tbody></table>`);
			expect(md).toBe("| Tags |\n| --- |\n| a<br>b |");
		});

		it("converts a list view", () => {
			const md = convert(`<ul class="dataview list-view-ul">
				<li><a class="internal-link" data-href="One">One</a></li>
				<li>plain <strong>bold</strong></li></ul>`);
			expect(md).toBe("- [[One]]\n- plain **bold**");
		});

		it("converts a task view using the data-task status, not the checked attribute", () => {
			const md = convert(`<div class="contains-task-list"><ul class="contains-task-list">
				<li class="dataview task-list-item" data-task=" "><input class="dataview task-list-item-checkbox" type="checkbox"> open</li>
				<li class="dataview task-list-item is-checked" data-task="x"><input class="dataview task-list-item-checkbox" type="checkbox"> done</li>
				<li class="dataview task-list-item" data-task="/"><input class="dataview task-list-item-checkbox" type="checkbox"> partial</li>
			</ul></div>`);
			expect(md).toBe("- [ ] open\n- [x] done\n- [/] partial");
		});

		it("falls back to the checkbox property when data-task is missing", () => {
			const md = convert(
				`<ul><li><input type="checkbox"> one</li><li><input type="checkbox"> two</li></ul>`,
				(root) => {
					root.querySelectorAll<HTMLInputElement>("input")[1].checked = true;
				},
			);
			expect(md).toBe("- [ ] one\n- [x] two");
		});

		it("keeps grouped results as headings with nested lists", () => {
			const md = convert(`<div class="dataview result-group">
				<h4>Group A</h4><ul><li>a1<ul><li>a1a</li></ul></li><li>a2</li></ul></div>`);
			expect(md).toBe("#### Group A\n\n- a1\n  - a1a\n- a2");
		});
	});

	describe("Tasks", () => {
		const tasksHtml = `<div class="block-language-tasks">
			<h4 class="tasks-group-heading">2026-09-20</h4>
			<ul class="contains-task-list plugin-tasks-query-result tasks-list-text">
				<li class="task-list-item plugin-tasks-list-item" data-task=" ">
					<input class="task-list-item-checkbox" type="checkbox">
					<span class="tasks-list-text"><span class="task-description"><span>Write <a class="internal-link" data-href="Spec">Spec</a> <a class="tag" href="#work">#work</a></span></span></span>
					<span class="task-extras">
						<span class="tasks-backlink"> (<a rel="noopener" target="_blank" class="internal-link">Plan</a>)</span>
						<a class="tasks-edit" title="Edit task"></a>
						<a class="tasks-postpone" title="Postpone"></a>
					</span>
				</li>
				<li class="task-list-item plugin-tasks-list-item is-checked" data-task="x">
					<input class="task-list-item-checkbox" type="checkbox">
					<span class="tasks-list-text"><span class="task-description"><span>Ship it</span></span></span>
					<span class="task-extras"><span class="tasks-backlink"> (<a rel="noopener" target="_blank" class="internal-link">Budget &gt; Month</a>)</span></span>
				</li>
			</ul>
			<div class="task-count">2 tasks</div></div>`;

		it("converts tasks, keeping backlinks and dropping controls", () => {
			expect(convert(tasksHtml)).toBe([
				"#### 2026-09-20",
				"",
				"- [ ] Write [[Spec]] #work ([[Plan]])",
				"- [x] Ship it ([[Budget#Month|Budget > Month]])",
				"",
				"2 tasks",
			].join("\n"));
		});
	});

	it("drops tags from task text when the query hides tags", () => {
		const item = (tag: string) => `<li data-task=" "><input type="checkbox">
			<span class="task-description"><span><a class="tag" href="#at/home">${tag}</a> Buy milk <a class="tag" href="#shop">#shop</a> today<a class="task-block-link"> ^abc</a></span></span></li>`;
		const hidden = convert(`<ul class="plugin-tasks-query-result tasks-layout-hide-tags">${item("#at/home")}</ul>`);
		expect(hidden).toBe("- [ ] Buy milk today");

		const shown = convert(`<ul class="plugin-tasks-query-result">${item("#at/home")}</ul>`);
		expect(shown).toBe("- [ ] #at/home Buy milk #shop today");
	});

	it("keeps tag group headings when the query hides task tags", () => {
		const md = convert(`<h4 class="tasks-group-heading"><a class="tag" href="#at/work">#at/work</a></h4>
			<ul class="tasks-layout-hide-tags"><li data-task=" "><input type="checkbox"><span class="task-description">Do it</span></li></ul>`);
		expect(md).toBe("#### #at/work\n\n- [ ] Do it");
	});

	it("leaves a Tasks short-mode backlink without a target as text", () => {
		const md = convert(`<ul><li data-task=" "><input type="checkbox">Do it
			<span class="tasks-backlink"><a rel="noopener" class="internal-link"> 🔗</a></span></li></ul>`);
		expect(md).toBe("- [ ] Do it 🔗");
	});

	it("converts code, quotes, rules and external links", () => {
		const md = convert(`<p>See <a href="https://example.com/a">site</a> and <code>x</code></p>
			<pre><code>a\nb</code></pre><blockquote><p>quoted</p></blockquote><hr>`);
		expect(md).toBe("See [site](https://example.com/a) and `x`\n\n```\na\nb\n```\n\n> quoted\n\n---");
	});

	it("uses a longer fence when the code contains backticks", () => {
		expect(convert("<pre>```\nx\n```</pre>")).toBe("````\n```\nx\n```\n````");
	});

	it("returns an empty string for empty input", () => {
		expect(convert("")).toBe("");
	});
});
