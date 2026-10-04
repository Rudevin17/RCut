import { describe, expect, test } from "bun:test";
import { BUILT_IN_EXPORT_PRESETS } from "@/export/presets";
import {
	clampMbps,
	formatExportSummary,
	formatFrameRate,
	getPresetWarnings,
	resolveEncodeParams,
	resolveExportFps,
	resolveExportSize,
	resolveVideoBitrate,
} from "@/export/resolve";
import { DEFAULT_EXPORT_SETTINGS } from "@/export/settings";

const fps = (numerator: number, denominator = 1) => ({ numerator, denominator });
const landscape = { width: 1920, height: 1080 };
const portrait = { width: 1080, height: 1920 };

describe("resolveExportSize", () => {
	test("project keeps the project size", () => {
		expect(resolveExportSize({ projectSize: landscape, resolution: "project" })).toEqual(landscape);
	});

	test("uses the short side for 16:9, 9:16 and 4:3", () => {
		expect(resolveExportSize({ projectSize: landscape, resolution: "2160" })).toEqual({ width: 3840, height: 2160 });
		expect(resolveExportSize({ projectSize: landscape, resolution: "1440" })).toEqual({ width: 2560, height: 1440 });
		expect(resolveExportSize({ projectSize: landscape, resolution: "720" })).toEqual({ width: 1280, height: 720 });
		expect(resolveExportSize({ projectSize: portrait, resolution: "1080" })).toEqual({ width: 1080, height: 1920 });
		expect(resolveExportSize({ projectSize: { width: 1440, height: 1080 }, resolution: "720" })).toEqual({ width: 960, height: 720 });
	});

	test("rounds the long side to an even number", () => {
		expect(resolveExportSize({ projectSize: { width: 2560, height: 1080 }, resolution: "720" })).toEqual({ width: 1706, height: 720 });
		expect(resolveExportSize({ projectSize: { width: 1366, height: 768 }, resolution: "720" })).toEqual({ width: 1280, height: 720 });
	});
});

describe("resolveExportFps", () => {
	test("project uses the project rate", () => {
		expect(resolveExportFps({ projectFps: fps(25), frameRate: "project" })).toEqual(fps(25));
	});

	test("fractional rates are exact rationals", () => {
		expect(resolveExportFps({ projectFps: fps(30), frameRate: "23.976" })).toEqual(fps(24000, 1001));
		expect(resolveExportFps({ projectFps: fps(30), frameRate: "29.97" })).toEqual(fps(30000, 1001));
		expect(resolveExportFps({ projectFps: fps(30), frameRate: "59.94" })).toEqual(fps(60000, 1001));
		expect(resolveExportFps({ projectFps: fps(30), frameRate: "60" })).toEqual(fps(60));
	});
});

describe("resolveVideoBitrate", () => {
	test("quality passes through", () => {
		expect(resolveVideoBitrate({ videoBitrate: { kind: "quality", quality: "high" }, fps: fps(30) })).toBe("high");
	});

	test("custom is converted to bits per second and clamped", () => {
		expect(resolveVideoBitrate({ videoBitrate: { kind: "custom", mbps: 12 }, fps: fps(30) })).toBe(12_000_000);
		expect(resolveVideoBitrate({ videoBitrate: { kind: "custom", mbps: 500 }, fps: fps(30) })).toBe(200_000_000);
		expect(resolveVideoBitrate({ videoBitrate: { kind: "custom", mbps: 0 }, fps: fps(30) })).toBe(1_000_000);
	});

	test("by-fps switches above 30 fps", () => {
		const videoBitrate = { kind: "by-fps", mbpsUpTo30: 8, mbpsAbove30: 12 } as const;
		expect(resolveVideoBitrate({ videoBitrate, fps: fps(30) })).toBe(8_000_000);
		expect(resolveVideoBitrate({ videoBitrate, fps: fps(30000, 1001) })).toBe(8_000_000);
		expect(resolveVideoBitrate({ videoBitrate, fps: fps(50) })).toBe(12_000_000);
		expect(resolveVideoBitrate({ videoBitrate, fps: fps(60000, 1001) })).toBe(12_000_000);
	});
});

describe("clampMbps", () => {
	test("keeps values inside [1, 200] and rejects non-numbers", () => {
		expect(clampMbps(50)).toBe(50);
		expect(clampMbps(0.2)).toBe(1);
		expect(clampMbps(999)).toBe(200);
		expect(clampMbps(Number.NaN)).toBe(1);
	});
});

describe("resolveEncodeParams", () => {
	test("combines size, fps, bitrate, audio and hardware preference", () => {
		const params = resolveEncodeParams({
			settings: {
				...DEFAULT_EXPORT_SETTINGS,
				resolution: "2160",
				frameRate: "60",
				videoBitrate: { kind: "by-fps", mbpsUpTo30: 40, mbpsAbove30: 60 },
				bitrateMode: "constant",
				audioBitrateKbps: 320,
				hardwareEncoding: false,
			},
			projectSize: landscape,
			projectFps: fps(30),
		});
		expect(params).toEqual({
			format: "mp4",
			width: 3840,
			height: 2160,
			fps: fps(60),
			videoBitrate: 60_000_000,
			bitrateMode: "constant",
			includeAudio: true,
			audioBitrate: 320_000,
			hardwareAcceleration: "prefer-software",
		});
	});

	test("hardware encoding on prefers hardware", () => {
		const params = resolveEncodeParams({ settings: DEFAULT_EXPORT_SETTINGS, projectSize: landscape, projectFps: fps(30) });
		expect(params.hardwareAcceleration).toBe("prefer-hardware");
		expect(params.videoBitrate).toBe("high");
	});
});

describe("getPresetWarnings", () => {
	const shorts = BUILT_IN_EXPORT_PRESETS.find((preset) => preset.id === "shorts");
	if (!shorts) throw new Error("shorts preset missing");

	test("warns when the project aspect differs from the preset's", () => {
		expect(getPresetWarnings({ preset: shorts, projectSize: landscape })).toEqual([
			"Project is 16:9. Shorts / TikTok / Reels expects 9:16. Change the canvas in project settings.",
		]);
	});

	test("no warning when the aspect matches or the preset has no expectation", () => {
		expect(getPresetWarnings({ preset: shorts, projectSize: portrait })).toEqual([]);
		const youtube = BUILT_IN_EXPORT_PRESETS[0];
		expect(getPresetWarnings({ preset: youtube, projectSize: portrait })).toEqual([]);
	});
});

describe("formatting", () => {
	test("formatFrameRate trims fractional rates", () => {
		expect(formatFrameRate(fps(60))).toBe("60");
		expect(formatFrameRate(fps(60000, 1001))).toBe("59.94");
		expect(formatFrameRate(fps(24000, 1001))).toBe("23.976");
	});

	test("formatExportSummary describes the output", () => {
		const params = resolveEncodeParams({
			settings: { ...DEFAULT_EXPORT_SETTINGS, resolution: "2160", frameRate: "59.94", videoBitrate: { kind: "custom", mbps: 60 } },
			projectSize: landscape,
			projectFps: fps(30),
		});
		expect(formatExportSummary({ params })).toBe("3840×2160 · 59.94 fps · 60 Mbps · H.264");
		const quality = resolveEncodeParams({ settings: { ...DEFAULT_EXPORT_SETTINGS, format: "webm" }, projectSize: landscape, projectFps: fps(30) });
		expect(formatExportSummary({ params: quality })).toBe("1920×1080 · 30 fps · High quality · VP9");
	});
});
