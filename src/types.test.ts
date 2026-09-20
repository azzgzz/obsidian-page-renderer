import { describe, it, expect } from "vitest";
import { DEFAULT_SETTINGS } from "@/types";

describe("DEFAULT_SETTINGS", () => {
	it("has no export format setting", () => {
		expect(DEFAULT_SETTINGS).not.toHaveProperty("defaultProfile");
	});

	it("has copyAttachments enabled by default", () => {
		expect(DEFAULT_SETTINGS.copyAttachments).toBe(true);
	});
});
