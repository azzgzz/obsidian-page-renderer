import { describe, expect, it } from "vitest";
import { composeOutput } from "@/export/composeOutput";

const note = {
	title: "Note",
	sourcePath: "folder/Note.md",
	propertiesBlock: "---\nstatus: draft\n---",
};
const plain = { includeProperties: false, includeSourcePathComment: false };

describe("composeOutput", () => {
	it("writes the title followed by the body", () => {
		expect(composeOutput({ ...note, propertiesBlock: null }, "Body\n", plain))
			.toBe("# Note\n\nBody\n\n");
	});

	it("opens the file with the properties block when requested", () => {
		expect(composeOutput(note, "Body\n", { ...plain, includeProperties: true }))
			.toBe("---\nstatus: draft\n---\n\n# Note\n\nBody\n\n");
	});

	it("omits the properties block when not requested", () => {
		expect(composeOutput(note, "Body\n", plain).startsWith("# Note\n")).toBe(true);
	});

	it("skips a properties block that has no content", () => {
		const empty = { ...note, propertiesBlock: "---\n---" };
		expect(composeOutput(empty, "Body\n", { ...plain, includeProperties: true }))
			.toBe("# Note\n\nBody\n\n");
	});

	it("adds the source path comment under the title when requested", () => {
		expect(composeOutput(note, "Body\n", { ...plain, includeSourcePathComment: true }))
			.toBe("# Note\n\n<!-- source: folder/Note.md -->\nBody\n\n");
	});
});
