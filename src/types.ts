export type ExportSettings = {
	defaultOutputFolder: string;
	expandEmbeds: boolean;
	includeSourcePathComments: boolean;
	includeProperties: boolean;
	copyAttachments: boolean;
	overwriteExisting: boolean;
};

export type ExportSource =
	| { type: "current-file"; path: string }
	| { type: "files"; paths: string[] }
	| { type: "folder"; path: string };

export type AttachmentCopy = {
	sourcePath: string;
	outputRelativePath: string;
};

export type NoteFragment = {
	markdown: string;
	sourcePath: string;
	blockBoundaryBefore?: boolean;
	blockBoundaryAfter?: boolean;
};

export type ExportPlan = {
	source: ExportSource;
	inputFiles: string[];
	outputRoot: string;
	outputFilename: string;
	outputFolderName?: string;
	outputFiles: string[];
	attachmentCopies: AttachmentCopy[];
};

/** One note read and prepared for export: title, properties and source-aware body pieces. */
export type ExportedNote = {
	sourcePath: string;
	title: string;
	/** The note's original YAML properties block, fences included; null when it has none. */
	propertiesBlock: string | null;
	/** Source-aware pieces from embed expansion; each is rewritten against its own sourcePath. */
	fragments: NoteFragment[];
	/** Warnings raised while assembling (e.g. embed resolution). */
	warnings: string[];
	/** Vault paths of notes inlined via embed expansion. */
	embeddedPaths: string[];
};

export const DEFAULT_SETTINGS: ExportSettings = {
	defaultOutputFolder: "exports",
	expandEmbeds: true,
	includeSourcePathComments: false,
	includeProperties: true,
	copyAttachments: true,
	overwriteExisting: false,
};
