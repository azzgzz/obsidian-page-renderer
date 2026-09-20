import { vi } from "vitest";

/**
 * Freezes only `Date`, so `timestampSuffix()` yields a deterministic value
 * (`2026-07-29T00:00:00Z` → `2026-07-29T00-00-00`). Undo with `vi.useRealTimers()`.
 */
export function freezeClock(iso: string): void {
	vi.useFakeTimers({ toFake: ["Date"] });
	vi.setSystemTime(new Date(iso));
}
