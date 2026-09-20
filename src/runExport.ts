import type { App } from "obsidian";
import { ExportSettings, ExportSource } from "@/types";
import { ExportSourceResolver } from "@/export/ExportSourceResolver";
import { buildExportPlan, validatePlan } from "@/export/ExportPlan";
import {
	ExportProgressCallbacks,
	ExportResult,
	ExportRunner,
	ExportRunOptions,
} from "@/export/ExportRunner";

export type ExportRequest = {
	source: ExportSource;
	outputFolder: string;
	outputFilename: string;
	outputFolderName?: string;
};

export interface RunExportOptions extends ExportRunOptions {
	/** Lets the caller cancel the run; a fresh runner is used when omitted. */
	runner?: ExportRunner;
	callbacks?: ExportProgressCallbacks;
}

export type RunExportOutcome =
	| { ok: true; result: ExportResult }
	| { ok: false; reason: "no-files" | "invalid-plan"; error: string };

/** The pipeline shared by the modal and the CLI: resolve → plan → validate → run. */
export async function runExport(
	app: App,
	settings: ExportSettings,
	request: ExportRequest,
	options: RunExportOptions = {},
): Promise<RunExportOutcome> {
	const files = new ExportSourceResolver(app).resolve(request.source);
	const plan = buildExportPlan({
		source: request.source,
		inputFiles: files.map((f) => f.path),
		outputRoot: request.outputFolder,
		outputFilename: request.outputFilename,
		outputFolderName: request.outputFolderName,
	});

	const error = validatePlan(plan);
	if (error) {
		return { ok: false, reason: files.length === 0 ? "no-files" : "invalid-plan", error };
	}

	const { runner = new ExportRunner(app), callbacks, ...runOptions } = options;
	const result = await runner.run(plan, settings, callbacks, runOptions);
	return { ok: true, result };
}
