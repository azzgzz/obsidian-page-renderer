import { ExportProgressCallbacks, SINGLE_FILE_PHASES } from "@/export/ExportRunner";

/** The part of ProgressNotice the export callbacks drive. */
export interface ProgressSink {
	start(total: number): void;
	setProgress(current: number, total: number): void;
	setPhase(phase: string): void;
}

/**
 * Maps runner callbacks onto a progress bar. A single note advances by phase,
 * a batch by completed file; either way the bar ends full.
 */
export function createProgressCallbacks(progress: ProgressSink): ExportProgressCallbacks {
	const stepCount = SINGLE_FILE_PHASES.length;
	let isSingleFile = false;
	let step = 0;

	return {
		onFileStart: (index, total) => {
			if (index > 0) return;
			isSingleFile = total === 1;
			step = 0;
			progress.start(isSingleFile ? stepCount : total);
		},
		onFileComplete: (index, total) => {
			// The last phase is skipped for notes without attachments, so close the bar here.
			if (isSingleFile) progress.setProgress(stepCount, stepCount);
			else progress.setProgress(index + 1, total);
		},
		onPhase: (phase) => {
			progress.setPhase(phase);
			if (isSingleFile) progress.setProgress(++step, stepCount);
		},
	};
}
