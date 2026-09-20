import { describe, it, expect, vi } from "vitest";
import { LinkRewriter, slugify } from "@/export/LinkRewriter";
import { AttachmentCopy } from "@/types";

function createMockApp() {
	return {
		metadataCache: {
			getFirstLinkpathDest: vi.fn((link: string) => {
				const map: Record<string, string> = {
					Note1: "notes/note1.md",
					Note2: "notes/note2.md",
					"Note2.md": "notes/note2.md",
					"image.png": "assets/image.png",
					"clip.mp4": "assets/clip.mp4",
					"reference.pdf": "assets/reference.pdf",
					"song.mp3": "assets/song.mp3",
					"archive.zip": "assets/archive.zip",
				};
				const p = map[link];
				return p ? { path: p } : null;
			}),
		},
		vault: {
			getAbstractFileByPath: vi.fn((path: string) => {
				const known = [
					"notes/note1.md",
					"notes/note2.md",
					"assets/image.png",
					"assets/clip.mp4",
					"assets/reference.pdf",
					"assets/song.mp3",
					"assets/archive.zip",
				];
				return known.includes(path) ? { path } : null;
			}),
		},
	} as never;
}

describe("LinkRewriter", () => {
	const exportedPaths = new Set(["notes/note1.md", "notes/note2.md"]);
	const attachments: AttachmentCopy[] = [
		{ sourcePath: "assets/image.png", outputRelativePath: "attachments/image.png" },
		{ sourcePath: "assets/clip.mp4", outputRelativePath: "attachments/clip.mp4" },
		{ sourcePath: "assets/reference.pdf", outputRelativePath: "assets/reference.pdf" },
		{ sourcePath: "assets/song.mp3", outputRelativePath: "attachments/song.mp3" },
		{ sourcePath: "assets/archive.zip", outputRelativePath: "attachments/archive.zip" },
	];

	function makeRewriter() {
		return new LinkRewriter(createMockApp(), exportedPaths, attachments);
	}

	function makeMappedRewriter(
		mappedExportedPaths = new Set(["notes/note1.md", "notes/note2.md"]),
	) {
		return new LinkRewriter(
			createMockApp(),
			mappedExportedPaths,
			attachments,
			new Map([
				["notes/note1.md", "exports/note1.md"],
				["notes/note2.md", "exports/note2.md"],
			]),
			"exports/note1.md",
			"exports",
		);
	}

	it("rewrites wiki link to included note as anchor", () => {
		const rewriter = makeRewriter();
		const { markdown } = rewriter.rewrite("See [[Note1]] for details", "notes/note1.md");
		expect(markdown).toBe("See [Note1](#note1) for details");
	});

	it("preserves alias text in wiki links", () => {
		const rewriter = makeRewriter();
		const { markdown } = rewriter.rewrite("See [[Note1|My Alias]]", "notes/note1.md");
		expect(markdown).toBe("See [My Alias](#note1)");
	});

	it("leaves external http links unchanged", () => {
		const rewriter = makeRewriter();
		const { markdown, warnings } = rewriter.rewrite(
			"Visit [example](http://example.com) and [secure](https://example.com)",
			"notes/note1.md",
		);
		expect(markdown).toBe("Visit [example](http://example.com) and [secure](https://example.com)");
		expect(warnings).toHaveLength(0);
	});

	it("warns on unresolved links", () => {
		const rewriter = makeRewriter();
		const { markdown, warnings } = rewriter.rewrite(
			"[[NonExistent]] is missing",
			"notes/note1.md",
		);
		expect(markdown).toBe("NonExistent is missing");
		expect(warnings).toEqual(
			expect.arrayContaining([expect.stringContaining("Unresolved link: NonExistent")]),
		);
	});

	it("rewrites wiki link with heading to anchor with heading", () => {
		const rewriter = makeRewriter();
		const { markdown } = rewriter.rewrite("[[Note1#Intro]]", "notes/note1.md");
		expect(markdown).toBe("[Note1](#note1-intro)");
	});

	it("turns an included note embed into a normal relative link", () => {
		const result = makeMappedRewriter()
			.rewrite("![[Note2]]", "notes/note1.md");

		expect(result.markdown).toBe("[Note2](note2.md)");
		expect(result.warnings).toEqual([]);
	});

	it("preserves a non-exported note embed as a wiki link without embed syntax", () => {
		const result = makeMappedRewriter(
			new Set(["notes/note1.md"]),
		).rewrite("![[Note2]]", "notes/note1.md");

		expect(result.markdown).toBe("[[Note2]]");
		expect(result.warnings).toEqual([]);
	});

	describe("markdown links", () => {
		it("rewrites a local note link to the relative path of the exported note", () => {
			const result = makeMappedRewriter().rewrite(
				"See [Note 2](Note2.md)",
				"notes/note1.md",
			);
			expect(result.markdown).toBe("See [Note 2](note2.md)");
		});

		it("rewrites a local attachment link to the copied asset", () => {
			const result = makeMappedRewriter().rewrite(
				"[Reference](../assets/reference.pdf)",
				"notes/note1.md",
			);
			expect(result.markdown).toBe("[Reference](assets/reference.pdf)");
		});

		it("preserves external and fragment-only links", () => {
			const markdown = "[Web](https://example.com) [Section](#heading)";
			const result = makeMappedRewriter()
				.rewrite(markdown, "notes/note1.md");
			expect(result.markdown).toBe(markdown);
			expect(result.warnings).toEqual([]);
		});

		it("preserves an unknown local link and warns once", () => {
			const result = makeMappedRewriter().rewrite(
				"[Missing](missing.md)",
				"notes/note1.md",
			);
			expect(result.markdown).toBe("[Missing](missing.md)");
			expect(result.warnings).toEqual(["Unresolved local link: missing.md"]);
		});

		it("does not rewrite markdown links inside inline code", () => {
			const markdown = "`[Note 2](Note2.md)`";
			const result = makeMappedRewriter()
				.rewrite(markdown, "notes/note1.md");
			expect(result.markdown).toBe(markdown);
			expect(result.warnings).toEqual([]);
		});
	});

	describe("markdown image links", () => {
		it("rewrites markdown image links to attachment paths", () => {
			const app = createMockApp();
			// resolveRelativePath resolves relative to sourcePath directory
			const rewriter = new LinkRewriter(app, exportedPaths, attachments);
			// Source is in "assets/" dir, so href "image.png" resolves to "assets/image.png"
			const { markdown, warnings } = rewriter.rewrite(
				"![alt](image.png)",
				"assets/something.md",
			);
			expect(markdown).toBe("![alt](attachments/image.png)");
			expect(warnings).toHaveLength(0);
		});

		it("preserves an optional title while rewriting the destination", () => {
			const result = makeRewriter().rewrite(
				'![alt](image.png "caption")',
				"assets/something.md",
			);
			expect(result.markdown).toBe('![alt](attachments/image.png "caption")');
		});

		it("leaves external http image links unchanged", () => {
			const rewriter = makeRewriter();
			const { markdown } = rewriter.rewrite(
				"![alt](https://example.com/img.png)",
				"notes/note1.md",
			);
			expect(markdown).toBe("![alt](https://example.com/img.png)");
		});
	});

	describe("embedded attachments", () => {
		it("rewrites a wiki embed for an attachment as a markdown image", () => {
			const rewriter = makeRewriter();
			const { markdown } = rewriter.rewrite("![[image.png]]", "notes/note1.md");
			// alt text must be populated (the link text); empty alt is not
			// rendered as an image by Obsidian and many Markdown viewers.
			expect(markdown).toBe("![image.png](attachments/image.png)");
		});

		it.each([
			["clip.mp4", "![clip.mp4](attachments/clip.mp4)"],
			["song.mp3", "![song.mp3](attachments/song.mp3)"],
			["reference.pdf", "![reference.pdf](assets/reference.pdf)"],
		])("keeps the embed syntax for %s", (link, expected) => {
			const { markdown } = makeRewriter().rewrite(`![[${link}]]`, "notes/note1.md");
			expect(markdown).toBe(expected);
		});

		it("does not add blank lines around a standalone attachment", () => {
			const result = makeRewriter().rewrite(
				"![[image.png]]\n## Title",
				"notes/note1.md",
			);

			expect(result.markdown).toBe("![image.png](attachments/image.png)\n## Title");
		});

		it("rewrites an attachment embed inside a table cell", () => {
			const result = makeRewriter().rewrite("| ![[image.png]] |", "notes/note1.md");

			expect(result.markdown).toBe("| ![image.png](attachments/image.png) |");
		});
	});

	describe("code block protection", () => {
		it("does not rewrite wiki links inside fenced code blocks", () => {
			const rewriter = makeRewriter();
			const md = "```\n[[Note1]]\n```";
			const { markdown } = rewriter.rewrite(md, "notes/note1.md");
			expect(markdown).toBe(md);
		});

		it("does not rewrite wiki links inside inline code", () => {
			const rewriter = makeRewriter();
			const md = "see `[[Note1]]` for details";
			const { markdown } = rewriter.rewrite(md, "notes/note1.md");
			expect(markdown).toBe(md);
		});
	});
});

describe("slugify", () => {
	it("converts text to lowercase hyphenated form", () => {
		expect(slugify("Hello World")).toBe("hello-world");
	});

	it("handles special characters", () => {
		expect(slugify("My Note & Stuff!")).toBe("my-note-stuff");
	});

	it("handles leading and trailing hyphens", () => {
		expect(slugify("--test--")).toBe("test");
	});

	it("handles CJK characters", () => {
		expect(slugify("中文标题")).toBe("中文标题");
	});

	it("handles Japanese kana", () => {
		expect(slugify("テスト")).toBe("テスト");
	});

	it("handles empty string", () => {
		expect(slugify("")).toBe("");
	});
});

describe("vault links", () => {
	// Vault notes that stay outside the export must remain reachable.
	const notes: Record<string, string> = {
		Outside: "Folder/Outside.md",
		"Deep note": "Folder/Deep note (draft).md",
		"Заметка": "Папка/Заметка.md",
		"clip.mp4": "assets/clip.mp4",
	};

	function makeApp() {
		return {
			metadataCache: {
				getFirstLinkpathDest: vi.fn((link: string) => {
					const path = notes[link];
					return path ? { path } : null;
				}),
			},
			vault: {},
		} as never;
	}

	function rewrite(markdown: string) {
		const rewriter = new LinkRewriter(makeApp(), new Set(["Current.md"]), []);
		return rewriter.rewrite(markdown, "Current.md");
	}

	it("turns a wiki link to a note outside the export into a Markdown link with the vault path", () => {
		const result = rewrite("See [[Outside]].");
		expect(result.markdown).toBe("See [Outside](Folder/Outside.md).");
		expect(result.warnings).toEqual([]);
	});

	it("keeps the alias as link text and the heading as a fragment", () => {
		const result = rewrite("[[Outside#Part two|the part]]");
		expect(result.markdown).toBe("[the part](Folder/Outside.md#Part%20two)");
	});

	it("escapes spaces and parentheses so the destination stays intact", () => {
		const result = rewrite("[[Deep note]]");
		expect(result.markdown).toBe("[Deep note](Folder/Deep%20note%20%28draft%29.md)");
	});

	it("keeps non-ASCII characters readable", () => {
		const result = rewrite("[[Заметка]]");
		expect(result.markdown).toBe("[Заметка](Папка/Заметка.md)");
	});

	it("keeps the extension of non-markdown files", () => {
		const result = rewrite("[[clip.mp4]]");
		expect(result.markdown).toBe("[clip.mp4](assets/clip.mp4)");
	});

	it("reads an alias written as \\| inside a table cell", () => {
		const result = rewrite("| [[Outside\\|Shown]] |");
		expect(result.markdown).toBe("| [Shown](Folder/Outside.md) |");
		expect(result.warnings).toEqual([]);
	});

	it("still reports and flattens links that do not resolve", () => {
		const result = rewrite("[[Missing|Gone]]");
		expect(result.markdown).toBe("Gone");
		expect(result.warnings).toEqual(["Unresolved link: Missing"]);
	});
});
