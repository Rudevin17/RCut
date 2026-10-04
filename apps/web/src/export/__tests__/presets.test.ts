import { describe, expect, test } from "bun:test";
import { BUILT_IN_EXPORT_PRESETS } from "@/export/presets";

describe("built-in export presets", () => {
	test("ids are unique", () => {
		const ids = BUILT_IN_EXPORT_PRESETS.map((preset) => preset.id);
		expect(new Set(ids).size).toBe(ids.length);
	});

	test("match the spec table", () => {
		const summary = BUILT_IN_EXPORT_PRESETS.map((preset) => [preset.id, preset.name, preset.settings.resolution, preset.settings.videoBitrate]);
		expect(summary).toEqual([
			["youtube-1080p", "YouTube 1080p", "1080", { kind: "by-fps", mbpsUpTo30: 8, mbpsAbove30: 12 }],
			["youtube-1440p", "YouTube 1440p", "1440", { kind: "by-fps", mbpsUpTo30: 16, mbpsAbove30: 24 }],
			["youtube-4k", "YouTube 4K", "2160", { kind: "by-fps", mbpsUpTo30: 40, mbpsAbove30: 60 }],
			["shorts", "Shorts / TikTok / Reels", "1080", { kind: "custom", mbps: 12 }],
			["master", "High quality master", "project", { kind: "quality", quality: "very_high" }],
			["small", "Small file", "720", { kind: "quality", quality: "medium" }],
		]);
	});

	test("all presets share the common settings", () => {
		for (const preset of BUILT_IN_EXPORT_PRESETS) {
			expect(preset.settings.format).toBe("mp4");
			expect(preset.settings.frameRate).toBe("project");
			expect(preset.settings.bitrateMode).toBe("variable");
			expect(preset.settings.includeAudio).toBe(true);
			expect(preset.settings.audioBitrateKbps).toBe(192);
			expect(preset.settings.hardwareEncoding).toBe(true);
		}
	});

	test("only Shorts expects an aspect ratio", () => {
		const withAspect = BUILT_IN_EXPORT_PRESETS.filter((preset) => preset.expectedAspect);
		expect(withAspect.map((preset) => [preset.id, preset.expectedAspect])).toEqual([["shorts", { width: 9, height: 16 }]]);
	});
});
