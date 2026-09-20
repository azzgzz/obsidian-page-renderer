/** @vitest-environment jsdom */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { waitForPostProcessors } from "@/export/native-renderer";

describe("waitForPostProcessors", () => {
	beforeEach(() => {
		vi.useFakeTimers();
	});
	afterEach(() => {
		vi.useRealTimers();
	});

	it("resolves once the container has been quiet for the debounce interval", async () => {
		const el = document.createElement("div");
		const done = waitForPostProcessors(el, 5000);
		await vi.advanceTimersByTimeAsync(200);
		await expect(done).resolves.toBe(true);
	});

	it("keeps waiting while the readiness check fails, then resolves", async () => {
		const el = document.createElement("div");
		let ready = false;
		const isReady = vi.fn(() => ready);
		const done = waitForPostProcessors(el, 5000, isReady);

		await vi.advanceTimersByTimeAsync(1000);
		expect(isReady.mock.calls.length).toBeGreaterThan(1);

		ready = true;
		await vi.advanceTimersByTimeAsync(200);
		await expect(done).resolves.toBe(true);
	});

	it("gives up at the overall timeout when readiness never comes", async () => {
		const el = document.createElement("div");
		const done = waitForPostProcessors(el, 1000, () => false);
		await vi.advanceTimersByTimeAsync(1000);
		await expect(done).resolves.toBe(false);
	});
});
