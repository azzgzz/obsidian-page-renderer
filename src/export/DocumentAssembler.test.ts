import { describe, it, expect, vi } from "vitest";
import {
	DocumentAssembler,
	stripFrontmatter,
	readPropertiesBlock,
	deriveTitle,
	extractLeadingH1,
} from "@/export/DocumentAssembler";
import { joinMarkdownFragments } from "@/export/FragmentJoiner";

describe("stripFrontmatter", () => {
	it("strips simple frontmatter and returns body", () => {
		const content = "---\ntitle: Hello\n---\nBody text";
		const { body, frontmatter } = stripFrontmatter(content);
		expect(body).toBe("Body text");
		expect(frontmatter.title).toBe("Hello");
	});

	it("returns empty frontmatter for content without frontmatter", () => {
		const content = "Just some text\nNo frontmatter";
		const { body, frontmatter } = stripFrontmatter(content);
		expect(body).toBe(content);
		expect(frontmatter).toEqual({});
	});

	it("returns empty frontmatter when closing delimiter is missing", () => {
		const content = "---\ntitle: Hello\nBody text";
		const { body, frontmatter } = stripFrontmatter(content);
		expect(body).toBe(content);
		expect(frontmatter).toEqual({});
	});

	it("handles multi-line frontmatter values", () => {
		const content = "---\ntitle: Hello\nauthor: Jane\ndate: 2024-01-01\n---\nBody";
		const { body, frontmatter } = stripFrontmatter(content);
		expect(body).toBe("Body");
		expect(frontmatter.title).toBe("Hello");
		expect(frontmatter.author).toBe("Jane");
		expect(frontmatter.date).toBe("2024-01-01");
	});

	it("parses basic types: numbers, booleans, strings", () => {
		const content = "---\ncount: 42\nactive: true\nvisible: false\nname: test\npi: 3.14\nempty: null\n---\nBody";
		const { frontmatter } = stripFrontmatter(content);
		expect(frontmatter.count).toBe(42);
		expect(frontmatter.active).toBe(true);
		expect(frontmatter.visible).toBe(false);
		expect(frontmatter.name).toBe("test");
		expect(frontmatter.pi).toBe(3.14);
		expect(frontmatter.empty).toBeNull();
	});

	it("strips surrounding quotes from values", () => {
		const content = '---\ntitle: "Quoted Title"\nauthor: \'Single Quoted\'\n---\nBody';
		const { frontmatter } = stripFrontmatter(content);
		expect(frontmatter.title).toBe("Quoted Title");
		expect(frontmatter.author).toBe("Single Quoted");
	});

	it("skips nested and array lines", () => {
		const content = "---\ntitle: Top\ntags:\n  - tag1\n  - tag2\nnested:\n  key: val\n---\nBody";
		const { frontmatter } = stripFrontmatter(content);
		expect(frontmatter.title).toBe("Top");
		expect(frontmatter.tags).toBeNull();
		expect(frontmatter.nested).toBeNull();
	});

	it("parses CRLF frontmatter without leaking delimiters", () => {
		const result = stripFrontmatter("---\r\ntitle: Hello\r\n---\r\nBody");
		expect(result.frontmatter).toEqual({ title: "Hello" });
		expect(result.body).toBe("Body");
	});

	it("accepts a closing delimiter at end of file", () => {
		const result = stripFrontmatter("---\ntitle: Hello\n---");
		expect(result.frontmatter).toEqual({ title: "Hello" });
		expect(result.body).toBe("");
	});

	it("accepts an empty frontmatter block", () => {
		const result = stripFrontmatter("---\n---\nBody");
		expect(result.frontmatter).toEqual({});
		expect(result.body).toBe("Body");
	});

	it("preserves indentation at the beginning of the body", () => {
		const result = stripFrontmatter("---\ntitle: Hello\n---\n    code");
		expect(result.body).toBe("    code");
	});
});

describe("readPropertiesBlock", () => {
	it("returns the original block with its fences, nested values intact", () => {
		const block = '---\nтип: daily\nссылки:\n  - "[[2026-W38]]"\n---';
		expect(readPropertiesBlock(`${block}\nBody`)).toBe(block);
	});

	it("returns an empty block and null when there is none", () => {
		expect(readPropertiesBlock("---\n---\nBody")).toBe("---\n---");
		expect(readPropertiesBlock("Body only")).toBeNull();
		expect(readPropertiesBlock("---\ntitle: x\nBody")).toBeNull();
	});

	it("drops the trailing line break of the closing fence", () => {
		expect(readPropertiesBlock("---\r\na: 1\r\n---\r\nBody")).toBe("---\r\na: 1\r\n---");
	});
});

describe("DocumentAssembler titles", () => {
	const file = {
		path: "note.md",
		basename: "note",
		extension: "md",
		name: "note.md",
	};

	function createApp(content: string) {
		return {
			vault: {
				read: vi.fn().mockResolvedValue(content),
			},
		};
	}

	it("removes a leading H1 that duplicates the frontmatter title", async () => {
		const app = createApp("---\ntitle: Same\n---\n# Same\nBody");
		const document = await new DocumentAssembler(app as never)
			.assemble(file as never);

		expect(document.title).toBe("Same");
		expect(joinMarkdownFragments(document.fragments)).toBe("Body");
	});

	it("keeps a leading H1 that differs from the frontmatter title", async () => {
		const app = createApp("---\ntitle: Document\n---\n# Section\nBody");
		const document = await new DocumentAssembler(app as never)
			.assemble(file as never);

		expect(document.title).toBe("Document");
		expect(joinMarkdownFragments(document.fragments)).toBe("# Section\nBody");
	});
});

describe("deriveTitle", () => {
	const mockFile = {
		path: "test.md",
		basename: "test",
		extension: "md",
		name: "test.md",
	} as never;

	it("uses frontmatter title when present", () => {
		const result = deriveTitle(mockFile, { title: "My Title" });
		expect(result).toBe("My Title");
	});

	it("falls back to file basename when no frontmatter title", () => {
		const result = deriveTitle(mockFile, {});
		expect(result).toBe("test");
	});

	it("does not infer title from first heading (avoids duplication)", () => {
		// The first heading stays in the body; inferring the title from it
		// would duplicate it as the document title.
		const result = deriveTitle(mockFile, {});
		expect(result).toBe("test");
		expect(result).not.toBe("Heading One");
	});
});

describe("extractLeadingH1", () => {
	it("extracts title and removes the H1 line when body starts with H1", () => {
		const result = extractLeadingH1("# My Real Title\n\nBody text");
		expect(result).not.toBeNull();
		expect(result!.title).toBe("My Real Title");
		expect(result!.remaining).toBe("Body text");
	});

	it("returns null when body does not start with H1", () => {
		expect(extractLeadingH1("Just plain text")).toBeNull();
		expect(extractLeadingH1("## Subtitle only")).toBeNull();
		expect(extractLeadingH1("")).toBeNull();
	});

	it("does not match H1 indented or mid-document", () => {
		// leading spaces → not a heading
		expect(extractLeadingH1("   # Not a heading")).toBeNull();
		// H1 after other content → not leading
		expect(extractLeadingH1("Intro\n# Heading")).toBeNull();
	});

	it("trims trailing whitespace from the title", () => {
		const result = extractLeadingH1("# Spaced Title   \nBody");
		expect(result!.title).toBe("Spaced Title");
	});
});

describe("DocumentAssembler embed expansion", () => {
	function makeTFile(path: string) {
		const name = path.split("/").pop() ?? path;
		return {
			path,
			basename: name.replace(/\.md$/, ""),
			extension: "md",
			name,
		};
	}

	function createApp(files: Record<string, string>, linkmap: Record<string, string> = {}) {
		return {
			vault: {
				read: vi.fn(async (f: { path: string }) => {
					const content = files[f.path];
					if (content === undefined) throw new Error(`No such file: ${f.path}`);
					return content;
				}),
				getAbstractFileByPath: vi.fn((p: string) =>
					files[p] !== undefined ? { path: p, extension: "md" } : null,
				),
			},
			metadataCache: {
				getFirstLinkpathDest: vi.fn((link: string) => {
					const dest = linkmap[link];
					return dest ? { path: dest } : null;
				}),
				getFileCache: vi.fn(() => ({})),
			},
		};
	}

	it("expands embeds, reports embedded paths, and keeps fragments source-aware", async () => {
		const app = createApp({
			"main.md": "Intro\n\n![[part]]\n\nEnd",
			"part.md": "Part body",
		}, { part: "part.md" });
		const assembler = new DocumentAssembler(app as never, true);
		const doc = await assembler.assemble(makeTFile("main.md") as never);

		expect(doc.fragments.map((f) => f.sourcePath)).toEqual(["main.md", "part.md", "main.md"]);
		expect(doc.embeddedPaths).toEqual(["part.md"]);
		expect(joinMarkdownFragments(doc.fragments)).toBe("Intro\n\nPart body\n\nEnd");
	});

	it("assembles an inline note transclusion as an independent block", async () => {
		const app = createApp({
			"main.md": "Before ![[part]] after",
			"part.md": "## Part",
		}, { part: "part.md" });
		const assembler = new DocumentAssembler(app as never, true);
		const doc = await assembler.assemble(makeTFile("main.md") as never);

		expect(joinMarkdownFragments(doc.fragments)).toBe("Before\n\n## Part\n\nafter");
		expect(doc.fragments[1]).toMatchObject({
			sourcePath: "part.md",
			blockBoundaryBefore: true,
			blockBoundaryAfter: true,
		});
	});

	it("keeps embeds as-is when disabled", async () => {
		const app = createApp({ "main.md": "![[part]]" }, { part: "part.md" });
		const assembler = new DocumentAssembler(app as never);
		const doc = await assembler.assemble(makeTFile("main.md") as never);

		expect(joinMarkdownFragments(doc.fragments)).toBe("![[part]]");
		expect(doc.embeddedPaths).toEqual([]);
	});

	it("does not let an embedded leading H1 steal the host title", async () => {
		const app = createApp({
			"main.md": "![[chapter]]",
			"chapter.md": "# Chapter\nBody",
		}, { chapter: "chapter.md" });
		const assembler = new DocumentAssembler(app as never, true);
		const doc = await assembler.assemble(makeTFile("main.md") as never);

		expect(doc.title).toBe("main");
		expect(joinMarkdownFragments(doc.fragments)).toBe("# Chapter\nBody");
	});

	it("reports the source path, properties block and no warnings for a plain note", async () => {
		const app = createApp({ "main.md": "---\nstatus: draft\n---\nBody" });
		const doc = await new DocumentAssembler(app as never)
			.assemble(makeTFile("main.md") as never);

		expect(doc.sourcePath).toBe("main.md");
		expect(doc.propertiesBlock).toBe("---\nstatus: draft\n---");
		expect(doc.warnings).toEqual([]);
		expect(doc.fragments).toEqual([{ markdown: "Body", sourcePath: "main.md" }]);
	});
});
