import type { ExportedNote } from "@/types";

export interface ComposeOptions {
	includeProperties: boolean;
	includeSourcePathComment: boolean;
}

/**
 * Builds the text of one exported file: properties block, title, optional
 * source comment and the already rewritten body.
 */
export function composeOutput(
	note: Pick<ExportedNote, "title" | "propertiesBlock" | "sourcePath">,
	body: string,
	options: ComposeOptions,
): string {
	const parts: string[] = [];

	// YAML properties must open the file. Notes without properties (or with an
	// empty block) get no block at all.
	const properties = note.propertiesBlock;
	if (options.includeProperties && properties && hasPropertiesContent(properties)) {
		parts.push(`${properties}\n`);
	}

	parts.push(`# ${note.title}\n`);
	parts.push(
		options.includeSourcePathComment
			? `<!-- source: ${note.sourcePath} -->\n${body}`
			: body,
	);
	parts.push("");

	return parts.join("\n");
}

// A block is fences around YAML; nothing between them means nothing to show.
function hasPropertiesContent(block: string): boolean {
	return block
		.replace(/^---\r?\n?/, "")
		.replace(/\r?\n?---$/, "")
		.trim() !== "";
}
