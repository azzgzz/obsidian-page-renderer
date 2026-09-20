/** @vitest-environment jsdom */
import { describe, expect, it, vi } from "vitest";
import {
	QueryBlockRenderer,
	readQueryResult,
	resolveQueryBlocks,
} from "@/export/QueryBlockResolver";

const ok = (markdown: string) => ({ ok: true as const, markdown });

function stubRenderer(results: Record<string, string>): QueryBlockRenderer {
	return vi.fn(async (_block, _path, language) => {
		return language in results ? ok(results[language]) : { ok: false as const, reason: "unsupported" };
	});
}

describe("resolveQueryBlocks", () => {
	it("returns the markdown untouched and never renders when there are no query blocks", async () => {
		const render = stubRenderer({});
		const md = "# Title\n\n```js\nconsole.log(1)\n```\n";
		expect(await resolveQueryBlocks(md, "n.md", render)).toEqual({ markdown: md, warnings: [] });
		expect(render).not.toHaveBeenCalled();
	});

	it("replaces dataview, dataviewjs and tasks blocks, passing the block source and note path", async () => {
		const render = stubRenderer({ dataview: "| a |\n| --- |\n| 1 |", tasks: "- [ ] t" });
		const md = "before\n\n```dataview\nTABLE x\nFROM \"y\"\n```\n\nmid\n\n```tasks\nnot done\n```\n\nafter";
		const result = await resolveQueryBlocks(md, "dir/n.md", render);

		expect(result.markdown).toBe("before\n\n| a |\n| --- |\n| 1 |\n\nmid\n\n- [ ] t\n\nafter");
		expect(result.warnings).toEqual([]);
		expect(render).toHaveBeenCalledWith("```dataview\nTABLE x\nFROM \"y\"\n```", "dir/n.md", "dataview");
		expect(render).toHaveBeenCalledWith("```tasks\nnot done\n```", "dir/n.md", "tasks");
	});

	it("separates the result from an adjacent paragraph", async () => {
		const result = await resolveQueryBlocks(
			"text\n```dataview\nLIST\n```\nmore",
			"n.md",
			stubRenderer({ dataview: "- a" }),
		);
		expect(result.markdown).toBe("text\n\n- a\n\nmore");
	});

	it("keeps the source block and warns when rendering fails", async () => {
		const md = "```dataviewjs\ndv.list([1])\n```";
		const result = await resolveQueryBlocks(md, "n.md", stubRenderer({}));
		expect(result.markdown).toBe(md);
		expect(result.warnings).toEqual([
			'Query block not rendered in "n.md" (line 1, dataviewjs): unsupported',
		]);
	});

	it("turns a throwing renderer into a warning and keeps going", async () => {
		const render: QueryBlockRenderer = async (_b, _p, language) => {
			if (language === "dataview") throw new Error("boom");
			return ok("- ok");
		};
		const result = await resolveQueryBlocks("```dataview\nLIST\n```\n\n```tasks\nx\n```", "n.md", render);
		expect(result.markdown).toBe("```dataview\nLIST\n```\n\n- ok");
		expect(result.warnings).toEqual([expect.stringContaining("boom")]);
	});

	it("leaves blocks as source and warns once when no renderer is available", async () => {
		const md = "```tasks\nnot done\n```\n\n```dataview\nLIST\n```";
		const result = await resolveQueryBlocks(md, "n.md", null);
		expect(result.markdown).toBe(md);
		expect(result.warnings).toHaveLength(1);
	});

	it("does not touch query examples inside other fences", async () => {
		const md = "````md\n```dataview\nLIST\n```\n````\n\n~~~text\n```tasks\nx\n```\n~~~";
		const render = stubRenderer({ dataview: "- a", tasks: "- b" });
		expect((await resolveQueryBlocks(md, "n.md", render)).markdown).toBe(md);
		expect(render).not.toHaveBeenCalled();
	});

	it("supports tilde and longer backtick fences", async () => {
		const render = stubRenderer({ dataview: "- a", tasks: "- b" });
		const md = "~~~dataview\nLIST\n~~~\n\n````tasks\nx\n````";
		expect((await resolveQueryBlocks(md, "n.md", render)).markdown).toBe("- a\n\n- b");
	});

	it("ignores an unclosed fence", async () => {
		const render = stubRenderer({ dataview: "- a" });
		const md = "```dataview\nLIST";
		expect((await resolveQueryBlocks(md, "n.md", render)).markdown).toBe(md);
		expect(render).not.toHaveBeenCalled();
	});

	it("unwraps a block inside a callout and re-prefixes the result", async () => {
		const render = stubRenderer({ dataview: "| a |\n| --- |\n\n- b" });
		const md = "> [!note] Title\n> ```dataview\n> TABLE x\n> ```\n> tail";
		const result = await resolveQueryBlocks(md, "n.md", render);

		expect(render).toHaveBeenCalledWith("```dataview\nTABLE x\n```", "n.md", "dataview");
		expect(result.markdown).toBe(
			"> [!note] Title\n>\n> | a |\n> | --- |\n>\n> - b\n>\n> tail",
		);
	});

	it("unwraps an indented block inside a list item", async () => {
		const render = stubRenderer({ tasks: "- [ ] t" });
		const md = "- item\n  ```tasks\n  not done\n  ```";
		const result = await resolveQueryBlocks(md, "n.md", render);
		expect(render).toHaveBeenCalledWith("```tasks\nnot done\n```", "n.md", "tasks");
		expect(result.markdown).toBe("- item\n\n  - [ ] t");
	});

	it("keeps result order when blocks finish out of order", async () => {
		const render: QueryBlockRenderer = async (block) => {
			const n = /n(\d)/.exec(block)![1];
			await new Promise((r) => window.setTimeout(r, (5 - Number(n)) * 5));
			return ok(`result ${n}`);
		};
		const md = [1, 2, 3, 4].map((n) => `\`\`\`tasks\nn${n}\n\`\`\``).join("\n\n");
		expect((await resolveQueryBlocks(md, "n.md", render)).markdown)
			.toBe("result 1\n\nresult 2\n\nresult 3\n\nresult 4");
	});
});

describe("readQueryResult", () => {
	function read(html: string, language: string) {
		const container = new DOMParser().parseFromString(html, "text/html").body;
		return readQueryResult(container, language);
	}

	function failureReason(html: string, language: string): string {
		const outcome = read(html, language);
		if (outcome.ok) throw new Error("expected a failure");
		return outcome.reason;
	}

	it("converts a rendered result", () => {
		expect(read('<div class="block-language-tasks"><ul><li>a</li></ul></div>', "tasks"))
			.toEqual({ ok: true, markdown: "- a" });
	});

	it("reports the Dataview placeholder as unfinished", () => {
		expect(failureReason('<pre class="dataview dataview-error">Loading...</pre>', "dataview"))
			.toContain("did not finish");
	});

	it("reports the Tasks placeholder as unfinished", () => {
		expect(failureReason("<div>Loading Tasks ...</div>", "tasks")).toContain("did not finish");
	});

	it("surfaces Dataview and Tasks errors", () => {
		expect(failureReason('<pre class="dataview dataview-error">Dataview: Error: bad</pre>', "dataview"))
			.toBe("Dataview: Error: bad");
		expect(failureReason("<pre>Tasks query: bad filter</pre>", "tasks"))
			.toBe("Tasks query: bad filter");
	});

	it("detects a code block no plugin claimed", () => {
		expect(failureReason(
			'<pre class="language-dataview"><code class="language-dataview">LIST</code></pre>',
			"dataview",
		)).toContain("no plugin rendered");
	});

	it("marks an empty result with a single dash", () => {
		expect(read("<div></div>", "tasks")).toEqual({ ok: true, markdown: "-" });
	});
});
