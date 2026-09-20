import { App, TFile } from "obsidian";
import { AttachmentCopy, ExportPlan, ExportSettings, NoteFragment } from "@/types";
import { DocumentAssembler } from "@/export/DocumentAssembler";
import { AttachmentCollector } from "@/export/AttachmentCollector";
import { LinkRewriter } from "@/export/LinkRewriter";
import {
	createOutputTarget,
	OutputTarget,
	supportsExternalPaths,
} from "@/export/OutputTarget";
import { resolveEffectivePlan } from "@/export/ExportPlan";
import { composeOutput } from "@/export/composeOutput";
import { joinMarkdownFragments } from "@/export/FragmentJoiner";
import { ExportResult, resolveExportStatus } from "@/export/ExportOutcome";
import { writeReport } from "@/export/ExportReport";
import { isExternalPath, isMarkdown, wikiEmbedRe } from "@/export/utils";
import {
	createNativeQueryRenderer,
	QueryBlockRenderer,
	resolveQueryBlocks,
} from "@/export/QueryBlockResolver";

export type { ExportResult } from "@/export/ExportOutcome";

export interface ExportProgressCallbacks {
	onFileStart: (fileIndex: number, totalFiles: number, fileName: string) => void;
	onFileComplete: (fileIndex: number, totalFiles: number) => void;
	onPhase: (phase: string) => void;
}

export interface ExportRunOptions {
	/** Replaces the default vault/file-system target, e.g. to capture output in memory. */
	writer?: OutputTarget;
	/** Replaces the Obsidian-backed renderer of dataview/tasks blocks. */
	queryRenderer?: QueryBlockRenderer;
}

export const SINGLE_FILE_PHASES = [
	"Assembling document",
	"Collecting attachments",
	"Rewriting links",
	"Rendering output",
	"Copying attachments",
] as const;

// Per-file phase labels of a batch; same order as SINGLE_FILE_PHASES.
const BATCH_PHASE_PREFIXES = [
	"Assembling",
	"Collecting attachments for",
	"Rewriting links in",
	"Rendering",
	"Copying attachments for",
] as const;

export function phaseLabel(step: number, isSingleFile: boolean, basename: string): string {
	return isSingleFile
		? SINGLE_FILE_PHASES[step]
		: `${BATCH_PHASE_PREFIXES[step]} ${basename}`;
}

/** How one note's export ended; failures are thrown instead. */
type NoteOutcome = "completed" | "cancelled" | "attachment-failed";

/** State of one run, shared by the per-note steps. */
interface Run {
	plan: ExportPlan;
	settings: ExportSettings;
	callbacks?: ExportProgressCallbacks;
	target: OutputTarget;
	assetsRoot: string;
	exportedPaths: Set<string>;
	outputPathMap: Map<string, string>;
	assembler: DocumentAssembler;
	collector: AttachmentCollector | null;
	queryRenderer: QueryBlockRenderer | null;
	isSingleFile: boolean;
	copiedAttachments: Set<string>;
	warnings: string[];
	errors: string[];
	completedPaths: string[];
	incompletePaths: Set<string>;
	hasFailure: boolean;
	/** Set once the run starts writing, i.e. when a report folder can exist. */
	enteredOutputStage: boolean;
}

export class ExportRunner {
	private app: App;
	private cancelled = false;

	constructor(app: App) {
		this.app = app;
	}

	cancel(): void {
		this.cancelled = true;
	}

	async run(
		plan: ExportPlan,
		settings: ExportSettings,
		callbacks?: ExportProgressCallbacks,
		options?: ExportRunOptions,
	): Promise<ExportResult> {
		this.cancelled = false;

		// Preflight failures produce no outputs and never create report folders.
		if (!supportsExternalPaths() && isExternalPath(plan.outputRoot)) {
			return this.failedPreflight(
				plan,
				["External paths are not supported on mobile. Use a vault-relative path."],
			);
		}
		const { files, errors } = this.preflight(plan);
		if (files.length === 0) return this.failedPreflight(plan, errors);

		const target = options?.writer
			?? createOutputTarget(this.app, plan.outputRoot, settings.overwriteExisting);
		const effectivePlan = resolveEffectivePlan(plan, settings.overwriteExisting, target);
		const exportedPaths = new Set(effectivePlan.inputFiles);
		const run: Run = {
			plan: effectivePlan,
			settings,
			callbacks,
			target,
			assetsRoot: effectivePlan.outputFolderName
				? `${effectivePlan.outputRoot}/${effectivePlan.outputFolderName}`
				: effectivePlan.outputRoot,
			exportedPaths,
			outputPathMap: new Map(
				effectivePlan.inputFiles.map((path, i) => [path, effectivePlan.outputFiles[i]]),
			),
			assembler: new DocumentAssembler(this.app, settings.expandEmbeds),
			collector: settings.copyAttachments
				? new AttachmentCollector(this.app, exportedPaths)
				: null,
			// Query results are inlined before link rewriting, so the wiki links and
			// embeds they contain follow the same rules as the rest of the note.
			queryRenderer: options?.queryRenderer
				?? (typeof activeDocument !== "undefined" ? createNativeQueryRenderer(this.app) : null),
			isSingleFile: files.length === 1,
			copiedAttachments: new Set(),
			warnings: files.length > 500
				? [`Large export: ${files.length} files. This may take a while.`]
				: [],
			errors,
			completedPaths: [],
			incompletePaths: new Set(),
			hasFailure: errors.length > 0,
			enteredOutputStage: false,
		};

		for (let i = 0; i < files.length; i++) {
			if (this.cancelled) break;
			const file = files[i];
			const outputFilePath = run.outputPathMap.get(file.path) ?? effectivePlan.outputFiles[i];
			callbacks?.onFileStart(i, files.length, file.basename);

			let outcome: NoteOutcome;
			try {
				outcome = await this.exportNote(file, outputFilePath, run);
			} catch (err) {
				const msg = err instanceof Error ? err.message : String(err);
				run.errors.push(`Export failed for ${file.path}: ${msg}`);
				run.hasFailure = true;
				break;
			}
			if (outcome === "cancelled") break;
			if (outcome === "attachment-failed") continue;

			run.completedPaths.push(outputFilePath);
			callbacks?.onFileComplete(run.completedPaths.length - 1, files.length);
		}

		return this.finish(plan, run);
	}

	// Missing requested inputs stay counted in the total and are named as
	// errors; the remaining valid files still export.
	private preflight(plan: ExportPlan): { files: TFile[]; errors: string[] } {
		const files = plan.inputFiles
			.map((p) => this.app.vault.getAbstractFileByPath(p))
			.filter(isMarkdown);
		const validPaths = new Set(files.map((f) => f.path));
		const errors = plan.inputFiles
			.filter((p) => !validPaths.has(p))
			.map((p) => `Input file not found or not a Markdown note: ${p}`);
		if (files.length === 0) errors.push("No valid files found for export.");
		return { files, errors };
	}

	/**
	 * Exports one note through steps 1–6. Cancellation is checked after every
	 * step; a cancelled note that already started writing stays incomplete.
	 */
	private async exportNote(file: TFile, outputFilePath: string, run: Run): Promise<NoteOutcome> {
		const { plan, settings, callbacks, target } = run;
		const phase = (step: number) =>
			callbacks?.onPhase(phaseLabel(step, run.isSingleFile, file.basename));

		// Step 1: Read and prepare the note
		phase(0);
		const note = await run.assembler.assemble(file);
		run.warnings.push(...note.warnings);
		if (this.cancelled) return "cancelled";

		// Step 2: Collect attachments (embedded notes contribute their own
		// references; AttachmentCollector only adds non-markdown files)
		let attachments: AttachmentCopy[] = plan.attachmentCopies;
		if (run.collector) {
			phase(1);
			const embeddedFiles = note.embeddedPaths
				.map((p) => this.app.vault.getAbstractFileByPath(p))
				.filter(isMarkdown);
			const collected = await run.collector.collect([file, ...embeddedFiles]);
			attachments = collected.attachments;
			run.warnings.push(...collected.warnings);
		}
		if (this.cancelled) return "cancelled";

		// Step 3: Resolve queries and rewrite links per fragment, so content from
		// embedded notes resolves against its own source path rather than the host's.
		phase(2);
		const body = await this.rewriteFragments(note.fragments, outputFilePath, attachments, run);
		if (this.cancelled) return "cancelled";

		// Step 4: Ensure output folder exists — from here on the run has
		// entered its output-writing stage.
		await target.ensureFolder(outputFilePath.substring(0, outputFilePath.lastIndexOf("/")));
		run.enteredOutputStage = true;

		// Step 5: Write the document. The write can fail after partially
		// writing, so the primary counts as incomplete until all of its
		// required writes have succeeded.
		phase(3);
		run.incompletePaths.add(outputFilePath);
		await target.writeText(outputFilePath, composeOutput(note, body, {
			includeProperties: settings.includeProperties,
			includeSourcePathComment: settings.includeSourcePathComments,
		}));
		if (this.cancelled) return "cancelled";

		// Step 6: Copy attachments (deduplicated across files)
		if (settings.copyAttachments && attachments.length > 0) {
			phase(4);
			const copied = await this.copyAttachments(attachments, run);
			if (copied !== "ok") return copied === "failed" ? "attachment-failed" : "cancelled";
		}

		// All required writes for this file succeeded and cancellation did not
		// interrupt it.
		run.incompletePaths.delete(outputFilePath);
		return "completed";
	}

	private async rewriteFragments(
		fragments: NoteFragment[],
		outputFilePath: string,
		attachments: AttachmentCopy[],
		run: Run,
	): Promise<string> {
		const rewriter = new LinkRewriter(
			this.app,
			run.exportedPaths,
			attachments,
			run.outputPathMap,
			outputFilePath,
			run.assetsRoot,
		);
		let sawUnexpandedEmbed = false;
		const rewritten: NoteFragment[] = [];
		for (const fragment of fragments) {
			if (
				!run.settings.expandEmbeds
				&& this.containsUnexpandedNoteEmbed(fragment.markdown, fragment.sourcePath)
			) {
				sawUnexpandedEmbed = true;
			}
			const resolved = await resolveQueryBlocks(
				fragment.markdown,
				fragment.sourcePath,
				run.queryRenderer,
			);
			run.warnings.push(...resolved.warnings);
			const result = rewriter.rewrite(resolved.markdown, fragment.sourcePath);
			rewritten.push({ ...fragment, markdown: result.markdown });
			run.warnings.push(...result.warnings);
		}
		// Without this hint, embeds silently degrading to plain text looks
		// like a broken feature instead of a disabled one.
		if (sawUnexpandedEmbed) {
			run.warnings.push("Note embeds were not expanded (Expand note embeds setting is off)");
		}
		return joinMarkdownFragments(rewritten);
	}

	private async copyAttachments(
		attachments: AttachmentCopy[],
		run: Run,
	): Promise<"ok" | "failed" | "cancelled"> {
		await run.target.ensureFolder(`${run.assetsRoot}/assets`);
		if (this.cancelled) return "cancelled";

		let failed = false;
		for (const att of attachments) {
			if (this.cancelled) return "cancelled";
			// A path joins copiedAttachments only after a successful copy,
			// so a shared attachment that failed for one source is retried
			// for a later source that needs it.
			if (run.copiedAttachments.has(att.outputRelativePath)) continue;
			try {
				await run.target.copyBinaryFile(
					att.sourcePath,
					`${run.assetsRoot}/${att.outputRelativePath}`,
				);
				run.copiedAttachments.add(att.outputRelativePath);
			} catch {
				run.errors.push(`Failed to copy attachment: ${att.sourcePath}`);
				run.hasFailure = true;
				// This primary is not complete even though it exists.
				failed = true;
			}
		}
		if (this.cancelled) return "cancelled";
		return failed ? "failed" : "ok";
	}

	private async finish(requested: ExportPlan, run: Run): Promise<ExportResult> {
		const totalFiles = requested.inputFiles.length;
		if (this.cancelled) {
			run.warnings.push(
				totalFiles === 1
					? "Export was cancelled."
					: `Export was cancelled. ${run.completedPaths.length} of ${totalFiles} file(s) exported.`,
			);
		}

		const status = resolveExportStatus(
			this.cancelled, run.completedPaths.length, totalFiles, run.hasFailure,
		);
		const incompletePaths = [...run.incompletePaths];

		// Write a report only when the run reached its output-writing stage and
		// that directory actually exists; preflight failures create nothing.
		let reportPath: string | undefined;
		if (
			(run.warnings.length > 0 || run.errors.length > 0)
			&& run.enteredOutputStage
			&& run.target.folderExists(run.assetsRoot)
		) {
			try {
				// Never overwrite: the report gets its own free name next to the outputs.
				reportPath = await writeReport(
					createOutputTarget(this.app, run.assetsRoot, false),
					run.assetsRoot,
					run.plan,
					{
						status,
						totalFiles,
						completedPaths: run.completedPaths,
						incompletePaths,
						warnings: run.warnings,
						errors: run.errors,
					},
				);
			} catch (err) {
				const msg = err instanceof Error ? err.message : String(err);
				run.warnings.push(`Could not write export report: ${msg}`);
			}
		}

		return {
			status, success: status === "completed", outputRoot: run.assetsRoot,
			totalFiles,
			completedFiles: run.completedPaths.length,
			completedPaths: run.completedPaths, incompletePaths,
			warnings: run.warnings, errors: run.errors,
			...(reportPath ? { reportPath } : {}),
		};
	}

	private failedPreflight(plan: ExportPlan, errors: string[]): ExportResult {
		return {
			status: "failed",
			success: false,
			outputRoot: plan.outputRoot,
			totalFiles: plan.inputFiles.length,
			completedFiles: 0,
			completedPaths: [],
			incompletePaths: [],
			warnings: [],
			errors,
		};
	}

	private containsUnexpandedNoteEmbed(markdown: string, sourcePath: string): boolean {
		for (const match of markdown.matchAll(wikiEmbedRe())) {
			const [rawTarget] = match[1].split("|");
			const [target] = rawTarget.split("#");
			if (target === "") return true;

			const dest = this.app.metadataCache.getFirstLinkpathDest(target, sourcePath);
			if (!dest || dest.path.toLowerCase().endsWith(".md")) return true;
		}

		return false;
	}
}
