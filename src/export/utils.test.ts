import { describe, it, expect } from "vitest";
import {
	normalizePath,
	isExternalPath,
	isFile,
	isFolder,
	isMarkdown,
	timestampedFolder,
	wikiEmbedRe,
	extractCodeBlocks,
	restoreCodeBlocks,
	longestCommonDirPrefix,
} from "./utils";

describe("normalizePath", () => {
	it("collapses parent directory segments", () => {
		expect(normalizePath("a/b/../c")).toBe("a/c");
	});

	it("collapses multiple .. segments", () => {
		expect(normalizePath("a/b/c/../../d")).toBe("a/d");
	});

	it("removes single dot segments", () => {
		expect(normalizePath("a/./b/./c")).toBe("a/b/c");
	});

	it("handles leading ..", () => {
		expect(normalizePath("../a/b")).toBe("a/b");
	});

	it("handles empty segments from double slashes", () => {
		expect(normalizePath("a//b")).toBe("a/b");
	});

	it("returns empty string for entirely collapsed path", () => {
		expect(normalizePath("a/..")).toBe("");
	});
});

describe("isExternalPath", () => {
	it("detects unix absolute paths", () => {
		expect(isExternalPath("/home/user/docs")).toBe(true);
	});

	it("detects windows drive paths", () => {
		expect(isExternalPath("C:\\Users\\docs")).toBe(true);
		expect(isExternalPath("D:/docs")).toBe(true);
	});

	it("detects windows UNC paths", () => {
		expect(isExternalPath("\\\\server\\share\\exports")).toBe(true);
	});

	it("returns false for vault-relative paths", () => {
		expect(isExternalPath("Exports/output")).toBe(false);
	});
});

describe("timestampedFolder", () => {
	it("appends an ISO timestamp to the base path", () => {
		expect(timestampedFolder("Exports/my-export"))
			.toMatch(/^Exports\/my-export-\d{4}-\d{2}-\d{2}T\d{2}-\d{2}-\d{2}$/);
	});
});

describe("file type guards", () => {
	const file = { path: "a.md", extension: "md" } as never;
	const image = { path: "a.png", extension: "png" } as never;
	const folder = { path: "dir", children: [] } as never;

	it("distinguishes files from folders by shape", () => {
		expect(isFile(file)).toBe(true);
		expect(isFile(folder)).toBe(false);
		expect(isFile(null)).toBe(false);
		expect(isFolder(folder)).toBe(true);
		expect(isFolder(file)).toBe(false);
		expect(isFolder(null)).toBe(false);
	});

	it("recognises only Markdown notes as markdown", () => {
		expect(isMarkdown(file)).toBe(true);
		expect(isMarkdown(image)).toBe(false);
		expect(isMarkdown(folder)).toBe(false);
		expect(isMarkdown(null)).toBe(false);
	});
});

describe("wikiEmbedRe", () => {
	it("returns an independent global matcher per call", () => {
		const first = wikiEmbedRe();
		first.exec("![[a]] ![[b]]");
		expect(first.lastIndex).toBeGreaterThan(0);
		expect(wikiEmbedRe().lastIndex).toBe(0);
	});
});

describe("extractCodeBlocks / restoreCodeBlocks", () => {
	it("extracts and restores fenced code blocks", () => {
		const md = "before\n```js\nconst x = 1;\n```\nafter";
		const { text, blocks } = extractCodeBlocks(md);
		expect(text).not.toContain("```");
		expect(blocks.length).toBe(1);
		expect(restoreCodeBlocks(text, blocks)).toBe(md);
	});

	it("extracts and restores inline code", () => {
		const md = "use `foo()` and `bar()`";
		const { text, blocks } = extractCodeBlocks(md);
		expect(text).not.toContain("`");
		expect(blocks.length).toBe(2);
		expect(restoreCodeBlocks(text, blocks)).toBe(md);
	});

	it("handles mixed fenced and inline code", () => {
		const md = "text `inline` more\n```\nblock\n```\nend";
		const { text, blocks } = extractCodeBlocks(md);
		expect(restoreCodeBlocks(text, blocks)).toBe(md);
	});

	it("returns unchanged text when no code present", () => {
		const md = "plain text with no code";
		const { text, blocks } = extractCodeBlocks(md);
		expect(text).toBe(md);
		expect(blocks.length).toBe(0);
	});

	it("protects tilde fences", () => {
		const md = "a\n~~~\n[[x]]\n~~~\nb";
		const { text, blocks } = extractCodeBlocks(md);
		expect(text).not.toContain("[[x]]");
		expect(blocks.length).toBe(1);
		expect(restoreCodeBlocks(text, blocks)).toBe(md);
	});

	it("protects four-backtick fences containing triple-backtick content", () => {
		const md = "a\n````\n```js\ncode\n```\n````\nb";
		const { text, blocks } = extractCodeBlocks(md);
		expect(text).not.toContain("```js");
		expect(blocks.length).toBe(1);
		expect(restoreCodeBlocks(text, blocks)).toBe(md);
	});

	it("protects double-backtick inline code", () => {
		const md = "say `` ![[x]] `` aloud";
		const { text, blocks } = extractCodeBlocks(md);
		expect(text).not.toContain("![[x]]");
		expect(blocks.length).toBe(1);
		expect(restoreCodeBlocks(text, blocks)).toBe(md);
	});
});

describe("longestCommonDirPrefix", () => {
	it("returns empty string for empty array", () => {
		expect(longestCommonDirPrefix([])).toBe("");
	});

	it("returns directory for single path", () => {
		expect(longestCommonDirPrefix(["dir/file.md"])).toBe("dir/");
	});

	it("returns common directory for multiple paths", () => {
		expect(longestCommonDirPrefix(["dir/a.md", "dir/b.md"])).toBe("dir/");
	});

	it("returns empty string when no common directory", () => {
		expect(longestCommonDirPrefix(["a/file.md", "b/file.md"])).toBe("");
	});

	it("handles nested common directories", () => {
		expect(longestCommonDirPrefix(["a/b/c.md", "a/b/d.md"])).toBe("a/b/");
	});

	it("returns empty string when all paths are in root", () => {
		expect(longestCommonDirPrefix(["a.md", "b.md"])).toBe("");
	});
});
