import { describe, expect, it, vi } from "vitest";
import { createProgressCallbacks } from "@/ui/exportProgress";
import { SINGLE_FILE_PHASES } from "@/export/ExportRunner";

function createSink() {
	return { start: vi.fn(), setProgress: vi.fn(), setPhase: vi.fn() };
}

describe("createProgressCallbacks", () => {
	it("advances a single note by phase and ends full even without attachments", () => {
		const sink = createSink();
		const callbacks = createProgressCallbacks(sink);
		const total = SINGLE_FILE_PHASES.length;

		callbacks.onFileStart(0, 1, "Note");
		// A note without attachments never reports the last phase.
		for (const phase of SINGLE_FILE_PHASES.slice(0, -1)) callbacks.onPhase(phase);
		expect(sink.setProgress).toHaveBeenLastCalledWith(total - 1, total);
		callbacks.onFileComplete(0, 1);

		expect(sink.start).toHaveBeenCalledWith(total);
		expect(sink.setProgress).toHaveBeenLastCalledWith(total, total);
	});

	it("shows the current phase", () => {
		const sink = createSink();
		const callbacks = createProgressCallbacks(sink);
		callbacks.onFileStart(0, 1, "Note");
		callbacks.onPhase("Rewriting links");
		expect(sink.setPhase).toHaveBeenCalledWith("Rewriting links");
	});

	it("advances a batch by completed file and starts the bar once", () => {
		const sink = createSink();
		const callbacks = createProgressCallbacks(sink);

		callbacks.onFileStart(0, 3, "a");
		callbacks.onPhase("Assembling a");
		callbacks.onFileComplete(0, 3);
		callbacks.onFileStart(1, 3, "b");
		callbacks.onFileComplete(1, 3);

		expect(sink.start).toHaveBeenCalledTimes(1);
		expect(sink.start).toHaveBeenCalledWith(3);
		expect(sink.setProgress.mock.calls).toEqual([[1, 3], [2, 3]]);
	});
});
