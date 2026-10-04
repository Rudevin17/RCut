# Export Presets Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Give RCut professional export controls. These are resolution, frame rate, bitrate (Quality, custom Mbps, or YouTube-style by-fps), bitrate mode, audio bitrate and hardware encoding. Add six built-in presets and user-saved presets on top.

**Architecture:**
- Pure settings, preset and resolve logic lives in `apps/web/src/export/` and is unit-tested.
- `SceneExporter` renders at the project size as it does today. When the export size differs, it scales each frame onto an output-sized canvas just before encoding.
- It asks mediabunny's `canEncodeVideo` whether hardware encoding is possible and falls back to software.
- The persisted export store keeps the last-used settings and the custom presets.
- A new `ExportSettingsForm` component replaces the Format/Quality/Audio sections of the export popover.

**Tech Stack:** Next.js / React, zustand (persist), mediabunny 1.41.0 (WebCodecs), bun:test.

**Spec:** `docs/superpowers/specs/2026-10-04-export-presets-design.md`

## Global Constraints

**Repo and commits**
- Work in `D:\OpenCut`, branch `main`.
- **Commit messages must NOT contain any `Co-Authored-By` line or other Claude attribution.** This is the user's explicit instruction.
- Commits are authored as the configured git user (Rudevin).

**Code style**
- TypeScript: tabs, double quotes, object-parameter functions (`fn({ a, b })`).
- Tests use `bun:test` and live in `__tests__/` next to the code.
- Read React components before using them (AGENTS.md).

**File editing**
- Do NOT use `sed -i` on existing files. Do NOT write files through shell heredocs. Use the file-edit tools.
- A heredoc is fine for `git commit -F -`.

**Commands and baselines**
- Run tests from the repo root: `cd /d/OpenCut && bun test`. Baseline is 251 pass / 4 fail. The 4 failures are pre-existing `wasm.__wbindgen_start` load errors.
- Typecheck: `cd /d/OpenCut/apps/web && bunx tsc --noEmit 2>&1 | grep -c "error TS"`. Expected output: `0`.
- Pure modules in `src/export/` must not import `opencut-wasm` at runtime. Type-only imports (`import type`) are fine, because bun tests cannot load the WASM.

**Fixed values from the spec**
- Formats: `mp4` (H.264 `avc` + AAC) and `webm` (`vp9` + Opus).
- Resolution values: `project | 720 | 1080 | 1440 | 2160`. The number is the short side. The project aspect ratio is kept, and dimensions are rounded to even numbers. `project` returns the project size unchanged.
- Frame-rate values: `project | 23.976 | 24 | 25 | 29.97 | 30 | 50 | 59.94 | 60`. The fractional rates map to 24000/1001, 30000/1001 and 60000/1001.
- Custom Mbps is clamped to [1, 200].
- By-fps bitrate: the lower value applies when fps ≤ 30, the higher value when fps > 30.
- Audio bitrates: 128, 192 or 320 kbps. Default 192.
- Built-in presets:

  | Preset | Resolution | Video bitrate |
  |---|---|---|
  | YouTube 1080p | 1080 | 8 / 12 Mbps by fps |
  | YouTube 1440p | 1440 | 16 / 24 Mbps |
  | YouTube 4K | 2160 | 40 / 60 Mbps |
  | Shorts / TikTok / Reels | 1080 | custom 12 Mbps, expects 9:16 |
  | High quality master | project | Quality very_high |
  | Small file | 720 | Quality medium |

  Every preset uses mp4, VBR, audio on at 192 kbps and hardware encoding on.

---

## Task 1: Pure export settings, presets and resolve logic

**Files:**
- Create: `apps/web/src/export/settings.ts`
- Create: `apps/web/src/export/presets.ts`
- Create: `apps/web/src/export/resolve.ts`
- Test: `apps/web/src/export/__tests__/resolve.test.ts`
- Test: `apps/web/src/export/__tests__/presets.test.ts`

**Interfaces:**
- Consumes:
  - `ExportFormat` and `ExportQuality` from `@/export` (`apps/web/src/export/index.ts`, unchanged in this task);
  - `frameRateToFloat` from `@/fps/utils`;
  - `type FrameRate` from `opencut-wasm` (`{ numerator: number; denominator: number }`).
- Produces (later tasks rely on these exact names):
  - `settings.ts`:
    - `EXPORT_RESOLUTION_VALUES`, `ExportResolution`
    - `EXPORT_FRAME_RATE_VALUES`, `ExportFrameRate`
    - `AUDIO_BITRATE_KBPS_VALUES`, `AudioBitrateKbps`
    - `BITRATE_MODE_VALUES`, `BitrateMode`
    - `CUSTOM_MBPS_MIN`, `CUSTOM_MBPS_MAX`
    - `ExportVideoBitrate`, `ExportSettings`, `DEFAULT_EXPORT_SETTINGS`
  - `presets.ts`:
    - `ExportPreset { id; name; settings; expectedAspect? }`
    - `BUILT_IN_EXPORT_PRESETS`
  - `resolve.ts`:
    - types `ExportSize` and `EncodeParams`
    - `EXPORT_QUALITY_LABELS`
    - `resolveExportSize({ projectSize, resolution })`
    - `resolveExportFps({ projectFps, frameRate })`
    - `clampMbps(mbps)`
    - `resolveVideoBitrate({ videoBitrate, fps })`
    - `resolveEncodeParams({ settings, projectSize, projectFps })`
    - `getPresetWarnings({ preset, projectSize })`
    - `formatFrameRate(fps)`
    - `formatExportSummary({ params })`

- [ ] **Step 1: Write the failing tests**

`apps/web/src/export/__tests__/resolve.test.ts`:
```ts
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
```

`apps/web/src/export/__tests__/presets.test.ts`:
```ts
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
```

- [ ] **Step 2: Run the tests and confirm they fail**

Run: `cd /d/OpenCut && bun test apps/web/src/export/__tests__/resolve.test.ts apps/web/src/export/__tests__/presets.test.ts`

Expected: FAIL, because the modules `@/export/resolve`, `@/export/presets` and `@/export/settings` do not exist yet.

- [ ] **Step 3: Implement `settings.ts`**

```ts
import type { ExportFormat, ExportQuality } from "@/export";

export const EXPORT_RESOLUTION_VALUES = ["project", "720", "1080", "1440", "2160"] as const;
export type ExportResolution = (typeof EXPORT_RESOLUTION_VALUES)[number];

export const EXPORT_FRAME_RATE_VALUES = [
	"project",
	"23.976",
	"24",
	"25",
	"29.97",
	"30",
	"50",
	"59.94",
	"60",
] as const;
export type ExportFrameRate = (typeof EXPORT_FRAME_RATE_VALUES)[number];

export const AUDIO_BITRATE_KBPS_VALUES = [128, 192, 320] as const;
export type AudioBitrateKbps = (typeof AUDIO_BITRATE_KBPS_VALUES)[number];

export const BITRATE_MODE_VALUES = ["variable", "constant"] as const;
export type BitrateMode = (typeof BITRATE_MODE_VALUES)[number];

export const CUSTOM_MBPS_MIN = 1;
export const CUSTOM_MBPS_MAX = 200;

/** A quality level, a fixed rate, or a rate that depends on the frame rate (YouTube's upload table). */
export type ExportVideoBitrate =
	| { kind: "quality"; quality: ExportQuality }
	| { kind: "custom"; mbps: number }
	| { kind: "by-fps"; mbpsUpTo30: number; mbpsAbove30: number };

export interface ExportSettings {
	format: ExportFormat;
	resolution: ExportResolution;
	frameRate: ExportFrameRate;
	videoBitrate: ExportVideoBitrate;
	bitrateMode: BitrateMode;
	includeAudio: boolean;
	audioBitrateKbps: AudioBitrateKbps;
	hardwareEncoding: boolean;
}

export const DEFAULT_EXPORT_SETTINGS: ExportSettings = {
	format: "mp4",
	resolution: "project",
	frameRate: "project",
	videoBitrate: { kind: "quality", quality: "high" },
	bitrateMode: "variable",
	includeAudio: true,
	audioBitrateKbps: 192,
	hardwareEncoding: true,
};
```

- [ ] **Step 4: Implement `presets.ts`**

```ts
import { DEFAULT_EXPORT_SETTINGS, type ExportSettings } from "@/export/settings";

export interface ExportPreset {
	id: string;
	name: string;
	settings: ExportSettings;
	/** The aspect ratio the destination expects, e.g. 9:16 for Shorts. */
	expectedAspect?: { width: number; height: number };
}

const base = DEFAULT_EXPORT_SETTINGS;

// Bitrates follow YouTube's recommended SDR upload settings (lower value up to 30 fps, higher above).
export const BUILT_IN_EXPORT_PRESETS: ExportPreset[] = [
	{
		id: "youtube-1080p",
		name: "YouTube 1080p",
		settings: { ...base, resolution: "1080", videoBitrate: { kind: "by-fps", mbpsUpTo30: 8, mbpsAbove30: 12 } },
	},
	{
		id: "youtube-1440p",
		name: "YouTube 1440p",
		settings: { ...base, resolution: "1440", videoBitrate: { kind: "by-fps", mbpsUpTo30: 16, mbpsAbove30: 24 } },
	},
	{
		id: "youtube-4k",
		name: "YouTube 4K",
		settings: { ...base, resolution: "2160", videoBitrate: { kind: "by-fps", mbpsUpTo30: 40, mbpsAbove30: 60 } },
	},
	{
		id: "shorts",
		name: "Shorts / TikTok / Reels",
		settings: { ...base, resolution: "1080", videoBitrate: { kind: "custom", mbps: 12 } },
		expectedAspect: { width: 9, height: 16 },
	},
	{
		id: "master",
		name: "High quality master",
		settings: { ...base, resolution: "project", videoBitrate: { kind: "quality", quality: "very_high" } },
	},
	{
		id: "small",
		name: "Small file",
		settings: { ...base, resolution: "720", videoBitrate: { kind: "quality", quality: "medium" } },
	},
];
```

- [ ] **Step 5: Implement `resolve.ts`**

```ts
import type { FrameRate } from "opencut-wasm";
import type { ExportFormat, ExportQuality } from "@/export";
import type { ExportPreset } from "@/export/presets";
import {
	CUSTOM_MBPS_MAX,
	CUSTOM_MBPS_MIN,
	type BitrateMode,
	type ExportFrameRate,
	type ExportResolution,
	type ExportSettings,
	type ExportVideoBitrate,
} from "@/export/settings";
import { frameRateToFloat } from "@/fps/utils";

export interface ExportSize {
	width: number;
	height: number;
}

/** Everything the encoder needs, resolved against the project. */
export interface EncodeParams {
	format: ExportFormat;
	width: number;
	height: number;
	fps: FrameRate;
	/** Bits per second, or a quality level the encoder scales with resolution. */
	videoBitrate: number | ExportQuality;
	bitrateMode: BitrateMode;
	includeAudio: boolean;
	/** Bits per second. */
	audioBitrate: number;
	hardwareAcceleration: "prefer-hardware" | "prefer-software";
}

export const EXPORT_QUALITY_LABELS: Record<ExportQuality, string> = {
	low: "Low",
	medium: "Medium",
	high: "High",
	very_high: "Very high",
};

const FRAME_RATES: Record<Exclude<ExportFrameRate, "project">, FrameRate> = {
	"23.976": { numerator: 24_000, denominator: 1_001 },
	"24": { numerator: 24, denominator: 1 },
	"25": { numerator: 25, denominator: 1 },
	"29.97": { numerator: 30_000, denominator: 1_001 },
	"30": { numerator: 30, denominator: 1 },
	"50": { numerator: 50, denominator: 1 },
	"59.94": { numerator: 60_000, denominator: 1_001 },
	"60": { numerator: 60, denominator: 1 },
};

const CODEC_LABELS: Record<ExportFormat, string> = { mp4: "H.264", webm: "VP9" };

function roundToEven(value: number): number {
	return Math.max(2, Math.round(value / 2) * 2);
}

export function resolveExportSize({
	projectSize,
	resolution,
}: {
	projectSize: ExportSize;
	resolution: ExportResolution;
}): ExportSize {
	if (resolution === "project") {
		return { width: projectSize.width, height: projectSize.height };
	}
	const scale = Number(resolution) / Math.min(projectSize.width, projectSize.height);
	return {
		width: roundToEven(projectSize.width * scale),
		height: roundToEven(projectSize.height * scale),
	};
}

export function resolveExportFps({
	projectFps,
	frameRate,
}: {
	projectFps: FrameRate;
	frameRate: ExportFrameRate;
}): FrameRate {
	return frameRate === "project" ? projectFps : FRAME_RATES[frameRate];
}

export function clampMbps(mbps: number): number {
	if (!Number.isFinite(mbps)) return CUSTOM_MBPS_MIN;
	return Math.min(CUSTOM_MBPS_MAX, Math.max(CUSTOM_MBPS_MIN, mbps));
}

function mbpsToBps(mbps: number): number {
	return Math.round(mbps * 1_000_000);
}

export function resolveVideoBitrate({
	videoBitrate,
	fps,
}: {
	videoBitrate: ExportVideoBitrate;
	fps: FrameRate;
}): number | ExportQuality {
	switch (videoBitrate.kind) {
		case "quality":
			return videoBitrate.quality;
		case "custom":
			return mbpsToBps(clampMbps(videoBitrate.mbps));
		case "by-fps":
			return mbpsToBps(
				frameRateToFloat(fps) <= 30 ? videoBitrate.mbpsUpTo30 : videoBitrate.mbpsAbove30,
			);
	}
}

export function resolveEncodeParams({
	settings,
	projectSize,
	projectFps,
}: {
	settings: ExportSettings;
	projectSize: ExportSize;
	projectFps: FrameRate;
}): EncodeParams {
	const { width, height } = resolveExportSize({ projectSize, resolution: settings.resolution });
	const fps = resolveExportFps({ projectFps, frameRate: settings.frameRate });
	return {
		format: settings.format,
		width,
		height,
		fps,
		videoBitrate: resolveVideoBitrate({ videoBitrate: settings.videoBitrate, fps }),
		bitrateMode: settings.bitrateMode,
		includeAudio: settings.includeAudio,
		audioBitrate: settings.audioBitrateKbps * 1_000,
		hardwareAcceleration: settings.hardwareEncoding ? "prefer-hardware" : "prefer-software",
	};
}

function greatestCommonDivisor(a: number, b: number): number {
	return b === 0 ? a : greatestCommonDivisor(b, a % b);
}

function formatAspect({ width, height }: ExportSize): string {
	const divisor = greatestCommonDivisor(width, height);
	return `${width / divisor}:${height / divisor}`;
}

export function getPresetWarnings({
	preset,
	projectSize,
}: {
	preset: ExportPreset;
	projectSize: ExportSize;
}): string[] {
	const expected = preset.expectedAspect;
	if (!expected) return [];
	const difference = Math.abs(projectSize.width * expected.height - projectSize.height * expected.width);
	if (difference <= 0.01 * projectSize.height * expected.width) return [];
	return [
		`Project is ${formatAspect(projectSize)}. ${preset.name} expects ${expected.width}:${expected.height}. Change the canvas in project settings.`,
	];
}

export function formatFrameRate(fps: FrameRate): string {
	const value = frameRateToFloat(fps);
	return Number.isInteger(value) ? String(value) : String(Number(value.toFixed(3)));
}

export function formatExportSummary({ params }: { params: EncodeParams }): string {
	const bitrate =
		typeof params.videoBitrate === "number"
			? `${Number((params.videoBitrate / 1_000_000).toFixed(1))} Mbps`
			: `${EXPORT_QUALITY_LABELS[params.videoBitrate]} quality`;
	return `${params.width}×${params.height} · ${formatFrameRate(params.fps)} fps · ${bitrate} · ${CODEC_LABELS[params.format]}`;
}
```

- [ ] **Step 6: Run the tests and confirm they pass**

Run: `cd /d/OpenCut && bun test apps/web/src/export/__tests__/`

Expected: every test in `resolve.test.ts`, `presets.test.ts` and the existing `export-file-name.test.ts` passes.

Then run the typecheck: `cd /d/OpenCut/apps/web && bunx tsc --noEmit 2>&1 | grep -c "error TS"`. Expected output: `0`.

- [ ] **Step 7: Commit** (no Co-Authored-By line)

```bash
cd /d/OpenCut && git add apps/web/src/export && git commit -q -F - <<'EOF'
feat(export): add export settings, presets and resolve logic
EOF
```

---

## Task 2: Encoder: scaling, bitrate, audio bitrate, hardware fallback

**Files:**
- Modify: `apps/web/src/services/renderer/scene-exporter.ts` (whole file)
- Modify: `apps/web/src/core/managers/renderer-manager.ts` (`exportProject`, lines ~141-195)
- Modify: `apps/web/src/core/managers/project-manager.ts:213` (`export`)
- Modify: `apps/web/src/export/index.ts` (remove `ExportOptions`)
- Delete: `apps/web/src/export/defaults.ts`
- Modify: `apps/web/src/components/editor/export-button.tsx`: only the minimal call-site change, so that it compiles. Task 4 replaces the UI.

**Interfaces:**
- Consumes (from Task 1):
  - `ExportSettings` and `DEFAULT_EXPORT_SETTINGS` from `@/export/settings`;
  - `EncodeParams`, `resolveEncodeParams` and `formatFrameRate` from `@/export/resolve`.
- Produces:
  - `editor.project.export({ settings }: { settings: ExportSettings }): Promise<ExportResult>`;
  - `editor.renderer.exportProject({ settings, onProgress, onCancel })`;
  - `new SceneExporter({ renderWidth, renderHeight, encode, audioBuffer })`.

There is no unit test for this task. `SceneExporter` needs WebCodecs and a GPU, which bun cannot provide. Correctness is covered by:
- the pure logic tested in Task 1;
- tsc;
- the existing suite;
- the real exports in Task 5.

- [ ] **Step 1: Replace `scene-exporter.ts`**

```ts
import EventEmitter from "eventemitter3";

import {
	Output,
	Mp4OutputFormat,
	WebMOutputFormat,
	BufferTarget,
	CanvasSource,
	AudioBufferSource,
	canEncodeVideo,
	QUALITY_LOW,
	QUALITY_MEDIUM,
	QUALITY_HIGH,
	QUALITY_VERY_HIGH,
	type Quality,
} from "mediabunny";
import { mediaTimeToSeconds } from "opencut-wasm";
import { TICKS_PER_SECOND } from "@/wasm";
import { frameRateToFloat } from "@/fps/utils";
import type { RootNode } from "./nodes/root-node";
import type { ExportQuality } from "@/export";
import { formatFrameRate, type EncodeParams } from "@/export/resolve";
import { CanvasRenderer } from "./canvas-renderer";

type ExportParams = {
	/** The project canvas size. Frames always render at this size. */
	renderWidth: number;
	renderHeight: number;
	encode: EncodeParams;
	audioBuffer?: AudioBuffer;
};

type VideoCodec = "avc" | "vp9";
type HardwareAcceleration = "no-preference" | "prefer-hardware" | "prefer-software";

const qualityMap: Record<ExportQuality, Quality> = {
	low: QUALITY_LOW,
	medium: QUALITY_MEDIUM,
	high: QUALITY_HIGH,
	very_high: QUALITY_VERY_HIGH,
};

export type SceneExporterEvents = {
	progress: [progress: number];
	complete: [buffer: ArrayBuffer];
	error: [error: Error];
	cancelled: [];
};

export class SceneExporter extends EventEmitter<SceneExporterEvents> {
	private renderer: CanvasRenderer;
	private renderWidth: number;
	private renderHeight: number;
	private encode: EncodeParams;
	private audioBuffer?: AudioBuffer;

	private isCancelled = false;

	constructor({ renderWidth, renderHeight, encode, audioBuffer }: ExportParams) {
		super();
		this.renderer = new CanvasRenderer({
			width: renderWidth,
			height: renderHeight,
			fps: encode.fps,
		});
		this.renderWidth = renderWidth;
		this.renderHeight = renderHeight;
		this.encode = encode;
		this.audioBuffer = audioBuffer;
	}

	cancel(): void {
		this.isCancelled = true;
	}

	async export({
		rootNode,
	}: {
		rootNode: RootNode;
	}): Promise<ArrayBuffer | null> {
		const { format, fps, bitrateMode, includeAudio, audioBitrate } = this.encode;
		const fpsFloat = frameRateToFloat(fps);
		const ticksPerFrame = Math.round(
			(TICKS_PER_SECOND * fps.denominator) / fps.numerator,
		);
		const frameCount = Math.floor(rootNode.duration / ticksPerFrame);

		const codec: VideoCodec = format === "webm" ? "vp9" : "avc";
		const videoBitrate =
			typeof this.encode.videoBitrate === "number"
				? this.encode.videoBitrate
				: qualityMap[this.encode.videoBitrate];
		const hardwareAcceleration = await this.pickHardwareAcceleration({
			codec,
			bitrate: videoBitrate,
		});
		const encodeCanvas = this.createEncodeCanvas();

		const output = new Output({
			format: format === "webm" ? new WebMOutputFormat() : new Mp4OutputFormat(),
			target: new BufferTarget(),
		});

		const videoSource = new CanvasSource(encodeCanvas.canvas, {
			codec,
			bitrate: videoBitrate,
			bitrateMode,
			hardwareAcceleration,
		});

		output.addVideoTrack(videoSource, { frameRate: fpsFloat });

		let audioSource: AudioBufferSource | null = null;
		if (includeAudio && this.audioBuffer) {
			let audioCodec: "aac" | "opus" = format === "webm" ? "opus" : "aac";

			if (audioCodec === "aac" && typeof AudioEncoder !== "undefined") {
				const { supported } = await AudioEncoder.isConfigSupported({
					codec: "mp4a.40.2",
					sampleRate: this.audioBuffer.sampleRate,
					numberOfChannels: this.audioBuffer.numberOfChannels,
					bitrate: audioBitrate,
				});
				if (!supported) audioCodec = "opus";
			}

			audioSource = new AudioBufferSource({
				codec: audioCodec,
				bitrate: audioBitrate,
			});
			output.addAudioTrack(audioSource);
		}

		await output.start();

		if (audioSource && this.audioBuffer) {
			await audioSource.add(this.audioBuffer);
			audioSource.close();
		}

		for (let i = 0; i < frameCount; i++) {
			if (this.isCancelled) {
				await output.cancel();
				this.emit("cancelled");
				return null;
			}

			const timeTicks = i * ticksPerFrame;
			const timeSeconds = mediaTimeToSeconds({ time: timeTicks });
			await this.renderer.render({ node: rootNode, time: timeTicks });
			encodeCanvas.draw();
			await videoSource.add(timeSeconds, 1 / fpsFloat);

			this.emit("progress", i / frameCount);
		}

		if (this.isCancelled) {
			await output.cancel();
			this.emit("cancelled");
			return null;
		}

		videoSource.close();
		await output.finalize();
		this.emit("progress", 1);

		const buffer = output.target.buffer;
		if (!buffer) {
			this.emit("error", new Error("Failed to export video"));
			return null;
		}

		this.emit("complete", buffer);
		return buffer;
	}

	/** Prefers the requested acceleration, falls back to the browser's choice, and fails clearly if neither can encode. */
	private async pickHardwareAcceleration({
		codec,
		bitrate,
	}: {
		codec: VideoCodec;
		bitrate: number | Quality;
	}): Promise<HardwareAcceleration> {
		const { width, height, bitrateMode, fps } = this.encode;
		const candidates: HardwareAcceleration[] = [
			this.encode.hardwareAcceleration,
			"no-preference",
		];
		for (const hardwareAcceleration of candidates) {
			const supported = await canEncodeVideo(codec, {
				width,
				height,
				bitrate,
				bitrateMode,
				hardwareAcceleration,
			});
			if (supported) return hardwareAcceleration;
		}
		const codecLabel = codec === "vp9" ? "VP9" : "H.264";
		throw new Error(
			`This computer can't encode ${width}×${height} at ${formatFrameRate(fps)} fps as ${codecLabel}. Try a lower resolution or frame rate.`,
		);
	}

	/** The canvas the encoder reads: the render output itself, or a scaled copy when the export size differs. */
	private createEncodeCanvas(): {
		canvas: HTMLCanvasElement | OffscreenCanvas;
		draw: () => void;
	} {
		const source = this.renderer.getOutputCanvas();
		const { width, height } = this.encode;
		if (width === this.renderWidth && height === this.renderHeight) {
			return { canvas: source, draw: () => {} };
		}

		const canvas = new OffscreenCanvas(width, height);
		const context = canvas.getContext("2d");
		if (!context) {
			throw new Error("Couldn't create the canvas used to scale the export");
		}
		context.imageSmoothingEnabled = true;
		context.imageSmoothingQuality = "high";
		return {
			canvas,
			draw: () => context.drawImage(source, 0, 0, width, height),
		};
	}
}
```

If tsc rejects `bitrateMode` or `hardwareAcceleration` in the `canEncodeVideo` options: these come from `VideoEncodingAdditionalOptions` in `mediabunny/dist/mediabunny.d.ts` (around line 2912). Check that type, keep the options it accepts, and report the deviation.

- [ ] **Step 2: Update `renderer-manager.ts` `exportProject`**

Change the signature and the body (lines ~141-195) as follows. Leave the rest of the method (cancel interval, try/finally, catch) unchanged.

```ts
	async exportProject({
		settings,
		onProgress,
		onCancel,
	}: {
		settings: ExportSettings;
		onProgress?: ({ progress }: { progress: number }) => void;
		onCancel?: () => boolean;
	}): Promise<ExportResult> {
		try {
			const tracks = this.editor.scenes.getActiveScene().tracks;
			const mediaAssets = this.editor.media.getAssets();
			const activeProject = this.editor.project.getActive();

			if (!activeProject) {
				return { success: false, error: "No active project" };
			}

			const duration = this.editor.timeline.getTotalDuration();
			if (duration === 0) {
				return { success: false, error: "Project is empty" };
			}

			const canvasSize = activeProject.settings.canvasSize;
			const encode = resolveEncodeParams({
				settings,
				projectSize: canvasSize,
				projectFps: activeProject.settings.fps,
			});
			const { includeAudio } = encode;

			let audioBuffer: AudioBuffer | null = null;
			if (includeAudio) {
				onProgress?.({ progress: 0.05 });
				audioBuffer = await createTimelineAudioBuffer({
					tracks,
					mediaAssets,
					duration,
				});
			}

			const scene = buildScene({
				tracks,
				mediaAssets,
				duration,
				canvasSize,
				background: activeProject.settings.background,
			});

			const exporter = new SceneExporter({
				renderWidth: canvasSize.width,
				renderHeight: canvasSize.height,
				encode,
				audioBuffer: audioBuffer || undefined,
			});
```

Imports:
- Replace `import type { ExportOptions, ExportResult } from "@/export";` with `import type { ExportResult } from "@/export";`.
- Add `import type { ExportSettings } from "@/export/settings";`.
- Add `import { resolveEncodeParams } from "@/export/resolve";`.

The existing `exporter.on("progress", …)` block uses `includeAudio`, which is still defined.

- [ ] **Step 3: Update `project-manager.ts` `export`**

```ts
	async export({ settings }: { settings: ExportSettings }): Promise<ExportResult> {
		this.exportCancelRequested = false;
		this.exportState = { isExporting: true, progress: 0, result: null };
		this.notify();

		const result = await this.editor.renderer.exportProject({
			settings,
```

Leave the rest of the method unchanged.

Imports:
- Change `import type { ExportOptions, ExportResult, ExportState } from "@/export";` to `import type { ExportResult, ExportState } from "@/export";`.
- Add `import type { ExportSettings } from "@/export/settings";`.

- [ ] **Step 4: Remove `ExportOptions` and `defaults.ts`**

- In `apps/web/src/export/index.ts`, delete the `ExportOptions` interface and the now-unused `import type { FrameRate } from "opencut-wasm";`.
- Delete `apps/web/src/export/defaults.ts`.
- Run `grep -rn "ExportOptions\|DEFAULT_EXPORT_OPTIONS\|export/defaults" apps/web/src`. Only `export-button.tsx` should still reference them.

- [ ] **Step 5: Minimal `export-button.tsx` call-site change**

Task 4 rewrites the UI. For now:
- Replace `import { DEFAULT_EXPORT_OPTIONS } from "@/export/defaults";` with `import { DEFAULT_EXPORT_SETTINGS } from "@/export/settings";`.
- Initialise the state with:
  ```ts
  	const [format, setFormat] = useState<ExportFormat>(DEFAULT_EXPORT_SETTINGS.format);
  	const [quality, setQuality] = useState<ExportQuality>("high");
  	const [shouldIncludeAudio, setShouldIncludeAudio] = useState<boolean>(
  		DEFAULT_EXPORT_SETTINGS.includeAudio,
  	);
  ```
- Change the export call to:
  ```ts
  		const result = await editor.project.export({
  			settings: {
  				...DEFAULT_EXPORT_SETTINGS,
  				format,
  				videoBitrate: { kind: "quality", quality },
  				includeAudio: shouldIncludeAudio,
  			},
  		});
  ```

- [ ] **Step 6: Verify**

- `cd /d/OpenCut/apps/web && bunx tsc --noEmit 2>&1 | grep -c "error TS"` → `0`
- `cd /d/OpenCut && bun test 2>&1 | grep -E "^\s*[0-9]+ (pass|fail)"` → 251 + Task 1's new tests pass, 4 fail (pre-existing).
- `cd /d/OpenCut && bun run build:web 2>&1 | tail -3` → succeeds.

- [ ] **Step 7: Commit** (no Co-Authored-By line)

```bash
cd /d/OpenCut && git add -A apps/web/src && git commit -q -F - <<'EOF'
feat(export): scale, bitrate and hardware fallback in the encoder
EOF
```

---

## Task 3: Persist last-used settings and custom presets

**Files:**
- Create: `apps/web/src/export/custom-presets.ts`
- Modify: `apps/web/src/export/export-settings-store.ts`
- Test: `apps/web/src/export/__tests__/custom-presets.test.ts`

**Interfaces:**
- Consumes (from Task 1):
  - `ExportSettings` and `DEFAULT_EXPORT_SETTINGS` from `@/export/settings`;
  - `BUILT_IN_EXPORT_PRESETS` from `@/export/presets`.
- Produces:
  - `custom-presets.ts`:
    - `CustomExportPreset { id: string; name: string; settings: ExportSettings }`
    - `validatePresetName({ name, presets }): string | null`
    - `addCustomPreset({ presets, id, name, settings }): CustomExportPreset[]`
    - `migrateExportSettingsState({ persisted }): PersistedExportSettings`
  - Store, via `useExportSettingsStore`:
    - `exportFolder`, `setExportFolder` (unchanged)
    - `lastSettings`, `setLastSettings({ settings })`
    - `customPresets`
    - `addCustomPreset({ name, settings }): { ok: true; id: string } | { ok: false; error: string }`
    - `removeCustomPreset({ id })`

- [ ] **Step 1: Write the failing tests**

`apps/web/src/export/__tests__/custom-presets.test.ts`:
```ts
import { describe, expect, test } from "bun:test";
import {
	addCustomPreset,
	migrateExportSettingsState,
	validatePresetName,
} from "@/export/custom-presets";
import { DEFAULT_EXPORT_SETTINGS } from "@/export/settings";

const mine = { id: "a", name: "My 1440p60", settings: DEFAULT_EXPORT_SETTINGS };

describe("validatePresetName", () => {
	test("rejects empty names", () => {
		expect(validatePresetName({ name: "   ", presets: [] })).toBe("Enter a preset name");
	});

	test("rejects duplicates of custom or built-in names, ignoring case and spaces", () => {
		expect(validatePresetName({ name: " my 1440P60 ", presets: [mine] })).toBe("A preset with that name already exists");
		expect(validatePresetName({ name: "youtube 4k", presets: [] })).toBe("A preset with that name already exists");
	});

	test("accepts a new name", () => {
		expect(validatePresetName({ name: "Montage", presets: [mine] })).toBeNull();
	});
});

describe("addCustomPreset", () => {
	test("appends with a trimmed name", () => {
		const next = addCustomPreset({ presets: [mine], id: "b", name: "  Montage ", settings: DEFAULT_EXPORT_SETTINGS });
		expect(next).toEqual([mine, { id: "b", name: "Montage", settings: DEFAULT_EXPORT_SETTINGS }]);
	});
});

describe("migrateExportSettingsState", () => {
	test("old state with only a folder gets defaults", () => {
		expect(migrateExportSettingsState({ persisted: { exportFolder: "D:\\Videos" } })).toEqual({
			exportFolder: "D:\\Videos",
			lastSettings: DEFAULT_EXPORT_SETTINGS,
			customPresets: [],
		});
	});

	test("missing or invalid state gets defaults", () => {
		expect(migrateExportSettingsState({ persisted: undefined })).toEqual({
			exportFolder: null,
			lastSettings: DEFAULT_EXPORT_SETTINGS,
			customPresets: [],
		});
	});

	test("partial last settings are filled from the defaults", () => {
		const migrated = migrateExportSettingsState({
			persisted: { exportFolder: null, lastSettings: { format: "webm" }, customPresets: [mine] },
		});
		expect(migrated.lastSettings).toEqual({ ...DEFAULT_EXPORT_SETTINGS, format: "webm" });
		expect(migrated.customPresets).toEqual([mine]);
	});
});
```

- [ ] **Step 2: Run the tests and confirm they fail**

Run: `cd /d/OpenCut && bun test apps/web/src/export/__tests__/custom-presets.test.ts`

Expected: FAIL, because `@/export/custom-presets` does not exist.

- [ ] **Step 3: Implement `custom-presets.ts`**

```ts
import { BUILT_IN_EXPORT_PRESETS } from "@/export/presets";
import { DEFAULT_EXPORT_SETTINGS, type ExportSettings } from "@/export/settings";

export interface CustomExportPreset {
	id: string;
	name: string;
	settings: ExportSettings;
}

export interface PersistedExportSettings {
	exportFolder: string | null;
	lastSettings: ExportSettings;
	customPresets: CustomExportPreset[];
}

function normalizeName(name: string): string {
	return name.trim().toLowerCase();
}

/** Returns an error message, or null when the name can be used. */
export function validatePresetName({
	name,
	presets,
}: {
	name: string;
	presets: CustomExportPreset[];
}): string | null {
	const normalized = normalizeName(name);
	if (!normalized) return "Enter a preset name";
	const taken = [...BUILT_IN_EXPORT_PRESETS, ...presets].some(
		(preset) => normalizeName(preset.name) === normalized,
	);
	return taken ? "A preset with that name already exists" : null;
}

export function addCustomPreset({
	presets,
	id,
	name,
	settings,
}: {
	presets: CustomExportPreset[];
	id: string;
	name: string;
	settings: ExportSettings;
}): CustomExportPreset[] {
	return [...presets, { id, name: name.trim(), settings }];
}

function isRecord(value: unknown): value is Record<string, unknown> {
	return typeof value === "object" && value !== null;
}

/** Brings any older stored export state up to the current shape. */
export function migrateExportSettingsState({
	persisted,
}: {
	persisted: unknown;
}): PersistedExportSettings {
	const state = isRecord(persisted) ? persisted : {};
	const lastSettings = isRecord(state.lastSettings) ? state.lastSettings : {};
	return {
		exportFolder: typeof state.exportFolder === "string" ? state.exportFolder : null,
		lastSettings: { ...DEFAULT_EXPORT_SETTINGS, ...(lastSettings as Partial<ExportSettings>) },
		customPresets: Array.isArray(state.customPresets)
			? (state.customPresets as CustomExportPreset[])
			: [],
	};
}
```

- [ ] **Step 4: Replace `export-settings-store.ts`**

```ts
"use client";

import { create } from "zustand";
import { persist } from "zustand/middleware";
import {
	addCustomPreset,
	migrateExportSettingsState,
	validatePresetName,
	type CustomExportPreset,
} from "@/export/custom-presets";
import { DEFAULT_EXPORT_SETTINGS, type ExportSettings } from "@/export/settings";

interface ExportSettingsState {
	exportFolder: string | null;
	lastSettings: ExportSettings;
	customPresets: CustomExportPreset[];
	setExportFolder: ({ folder }: { folder: string }) => void;
	setLastSettings: ({ settings }: { settings: ExportSettings }) => void;
	addCustomPreset: ({
		name,
		settings,
	}: {
		name: string;
		settings: ExportSettings;
	}) => { ok: true; id: string } | { ok: false; error: string };
	removeCustomPreset: ({ id }: { id: string }) => void;
}

export const useExportSettingsStore = create<ExportSettingsState>()(
	persist(
		(set, get) => ({
			exportFolder: null,
			lastSettings: DEFAULT_EXPORT_SETTINGS,
			customPresets: [],
			setExportFolder: ({ folder }) => set({ exportFolder: folder }),
			setLastSettings: ({ settings }) => set({ lastSettings: settings }),
			addCustomPreset: ({ name, settings }) => {
				const presets = get().customPresets;
				const error = validatePresetName({ name, presets });
				if (error) return { ok: false, error };
				const id = crypto.randomUUID();
				set({ customPresets: addCustomPreset({ presets, id, name, settings }) });
				return { ok: true, id };
			},
			removeCustomPreset: ({ id }) =>
				set({
					customPresets: get().customPresets.filter((preset) => preset.id !== id),
				}),
		}),
		{
			name: "rcut-export-settings",
			version: 1,
			migrate: (persisted) => migrateExportSettingsState({ persisted }),
		},
	),
);
```

- [ ] **Step 5: Verify**

- `cd /d/OpenCut && bun test apps/web/src/export/__tests__/` → all pass.
- `cd /d/OpenCut/apps/web && bunx tsc --noEmit 2>&1 | grep -c "error TS"` → `0`.
- If tsc rejects the `migrate` return type (zustand expects the full state type), cast the result with `as ExportSettingsState`. zustand merges the persisted state with the initial state, so the actions are kept. Report this in the report.

- [ ] **Step 6: Commit** (no Co-Authored-By line)

```bash
cd /d/OpenCut && git add apps/web/src/export && git commit -q -F - <<'EOF'
feat(export): remember last export settings and save custom presets
EOF
```

---

## Task 4: Export popover UI

**Files:**
- Create: `apps/web/src/components/editor/export-settings-form.tsx`
- Modify: `apps/web/src/components/editor/export-button.tsx`

**Interfaces:**
- Consumes:
  - From Task 1: `@/export/settings`, `@/export/presets` and `@/export/resolve`, with the names listed in Task 1.
  - From Task 3: `useExportSettingsStore` and its `lastSettings`, `setLastSettings`, `customPresets`, `addCustomPreset` and `removeCustomPreset`; the type `CustomExportPreset`.
  - From Task 2: `editor.project.export({ settings })`.
  - UI kit: `@/components/ui/select` (`Select`, `SelectTrigger`, `SelectValue`, `SelectContent`, `SelectItem`, `SelectGroup`, `SelectLabel`), `@/components/ui/input` (`Input`), `@/components/ui/checkbox`, `@/components/ui/label`, `@/components/ui/button`, and `@/components/section` (`Section`, `SectionHeader`, `SectionTitle`, `SectionContent`). Read each before use.
- Produces: `ExportSettingsForm({ settings, onChange, projectSize, projectFps })`.

- [ ] **Step 1: Create `export-settings-form.tsx`**

```tsx
"use client";

import { type ReactNode, useState } from "react";
import type { FrameRate } from "opencut-wasm";
import { Trash2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
	Select,
	SelectContent,
	SelectGroup,
	SelectItem,
	SelectLabel,
	SelectTrigger,
	SelectValue,
} from "@/components/ui/select";
import {
	Section,
	SectionContent,
	SectionHeader,
	SectionTitle,
} from "@/components/section";
import { EXPORT_FORMAT_VALUES, EXPORT_QUALITY_VALUES } from "@/export";
import { useExportSettingsStore } from "@/export/export-settings-store";
import { BUILT_IN_EXPORT_PRESETS, type ExportPreset } from "@/export/presets";
import {
	EXPORT_QUALITY_LABELS,
	clampMbps,
	formatExportSummary,
	formatFrameRate,
	getPresetWarnings,
	resolveEncodeParams,
	resolveExportSize,
	type ExportSize,
} from "@/export/resolve";
import {
	AUDIO_BITRATE_KBPS_VALUES,
	BITRATE_MODE_VALUES,
	CUSTOM_MBPS_MAX,
	CUSTOM_MBPS_MIN,
	EXPORT_FRAME_RATE_VALUES,
	EXPORT_RESOLUTION_VALUES,
	type ExportSettings,
} from "@/export/settings";

const QUALITY_PREFIX = "quality:";
const DEFAULT_CUSTOM_MBPS = 12;

function isOneOf<T extends string | number>(values: readonly T[], value: unknown): value is T {
	return values.some((candidate) => candidate === value);
}

function Field({
	label,
	htmlFor,
	children,
}: {
	label: string;
	htmlFor?: string;
	children: ReactNode;
}) {
	return (
		<div className="flex items-center justify-between gap-3">
			<Label htmlFor={htmlFor} className="text-muted-foreground shrink-0 text-xs">
				{label}
			</Label>
			<div className="w-48">{children}</div>
		</div>
	);
}

function bitrateSelectValue({ settings }: { settings: ExportSettings }): string {
	const { videoBitrate } = settings;
	return videoBitrate.kind === "quality"
		? `${QUALITY_PREFIX}${videoBitrate.quality}`
		: videoBitrate.kind;
}

export function ExportSettingsForm({
	settings,
	onChange,
	projectSize,
	projectFps,
}: {
	settings: ExportSettings;
	onChange: (settings: ExportSettings) => void;
	projectSize: ExportSize;
	projectFps: FrameRate;
}) {
	const { customPresets, addCustomPreset, removeCustomPreset } =
		useExportSettingsStore();
	const [selectedPresetId, setSelectedPresetId] = useState<string | null>(null);
	const [isModified, setIsModified] = useState(false);
	const [isNaming, setIsNaming] = useState(false);
	const [presetName, setPresetName] = useState("");
	const [nameError, setNameError] = useState<string | null>(null);

	const allPresets: ExportPreset[] = [...BUILT_IN_EXPORT_PRESETS, ...customPresets];
	const selectedPreset =
		allPresets.find((preset) => preset.id === selectedPresetId) ?? null;
	const isCustomPresetSelected = customPresets.some(
		(preset) => preset.id === selectedPresetId,
	);
	const presetLabel = !selectedPreset
		? "Custom"
		: isModified
			? `Custom (from ${selectedPreset.name})`
			: selectedPreset.name;

	const params = resolveEncodeParams({ settings, projectSize, projectFps });
	const warnings = selectedPreset
		? getPresetWarnings({ preset: selectedPreset, projectSize })
		: [];

	const update = (patch: Partial<ExportSettings>) => {
		onChange({ ...settings, ...patch });
		setIsModified(true);
	};

	const selectPreset = (id: string) => {
		const preset = allPresets.find((candidate) => candidate.id === id);
		if (!preset) return;
		onChange(preset.settings);
		setSelectedPresetId(preset.id);
		setIsModified(false);
	};

	const deleteSelectedPreset = () => {
		if (!selectedPresetId) return;
		removeCustomPreset({ id: selectedPresetId });
		setSelectedPresetId(null);
	};

	const savePreset = () => {
		const result = addCustomPreset({ name: presetName, settings });
		if (!result.ok) {
			setNameError(result.error);
			return;
		}
		setSelectedPresetId(result.id);
		setIsModified(false);
		setIsNaming(false);
		setPresetName("");
		setNameError(null);
	};

	const changeBitrate = (value: string) => {
		if (value === "custom") {
			update({
				videoBitrate: {
					kind: "custom",
					mbps:
						typeof params.videoBitrate === "number"
							? params.videoBitrate / 1_000_000
							: DEFAULT_CUSTOM_MBPS,
				},
			});
			return;
		}
		const quality = value.slice(QUALITY_PREFIX.length);
		if (value.startsWith(QUALITY_PREFIX) && isOneOf(EXPORT_QUALITY_VALUES, quality)) {
			update({ videoBitrate: { kind: "quality", quality } });
		}
	};

	return (
		<div className="flex flex-col">
			<div className="flex flex-col gap-2 p-3">
				<div className="flex items-center gap-2">
					{/* An empty value after edits lets the same preset be re-applied. */}
					<Select
						value={isModified ? "" : (selectedPresetId ?? "")}
						onValueChange={selectPreset}
					>
						<SelectTrigger className="h-8 flex-1" aria-label="Export preset">
							<span className="truncate">{presetLabel}</span>
						</SelectTrigger>
						<SelectContent>
							<SelectGroup>
								<SelectLabel>Built-in</SelectLabel>
								{BUILT_IN_EXPORT_PRESETS.map((preset) => (
									<SelectItem key={preset.id} value={preset.id}>
										{preset.name}
									</SelectItem>
								))}
							</SelectGroup>
							{customPresets.length > 0 && (
								<SelectGroup>
									<SelectLabel>My presets</SelectLabel>
									{customPresets.map((preset) => (
										<SelectItem key={preset.id} value={preset.id}>
											{preset.name}
										</SelectItem>
									))}
								</SelectGroup>
							)}
						</SelectContent>
					</Select>
					{isCustomPresetSelected && selectedPreset && (
						<Button
							variant="ghost"
							size="icon"
							aria-label={`Delete preset ${selectedPreset.name}`}
							onClick={deleteSelectedPreset}
						>
							<Trash2 className="size-4" />
						</Button>
					)}
				</div>

				<Field label="Format">
					<Select
						value={settings.format}
						onValueChange={(value) => {
							if (isOneOf(EXPORT_FORMAT_VALUES, value)) update({ format: value });
						}}
					>
						<SelectTrigger className="h-8 w-full">
							<SelectValue />
						</SelectTrigger>
						<SelectContent>
							<SelectItem value="mp4">MP4 (H.264)</SelectItem>
							<SelectItem value="webm">WebM (VP9)</SelectItem>
						</SelectContent>
					</Select>
				</Field>

				<Field label="Resolution">
					<Select
						value={settings.resolution}
						onValueChange={(value) => {
							if (isOneOf(EXPORT_RESOLUTION_VALUES, value)) update({ resolution: value });
						}}
					>
						<SelectTrigger className="h-8 w-full">
							<SelectValue />
						</SelectTrigger>
						<SelectContent>
							{EXPORT_RESOLUTION_VALUES.map((resolution) => {
								const size = resolveExportSize({ projectSize, resolution });
								const name =
									resolution === "project"
										? "Project"
										: resolution === "2160"
											? "4K"
											: `${resolution}p`;
								return (
									<SelectItem key={resolution} value={resolution}>
										{`${name} (${size.width}×${size.height})`}
									</SelectItem>
								);
							})}
						</SelectContent>
					</Select>
				</Field>

				<Field label="Frame rate">
					<Select
						value={settings.frameRate}
						onValueChange={(value) => {
							if (isOneOf(EXPORT_FRAME_RATE_VALUES, value)) update({ frameRate: value });
						}}
					>
						<SelectTrigger className="h-8 w-full">
							<SelectValue />
						</SelectTrigger>
						<SelectContent>
							{EXPORT_FRAME_RATE_VALUES.map((frameRate) => (
								<SelectItem key={frameRate} value={frameRate}>
									{frameRate === "project"
										? `Project (${formatFrameRate(projectFps)} fps)`
										: `${frameRate} fps`}
								</SelectItem>
							))}
						</SelectContent>
					</Select>
				</Field>

				<Field label="Bitrate">
					<Select value={bitrateSelectValue({ settings })} onValueChange={changeBitrate}>
						<SelectTrigger className="h-8 w-full">
							<SelectValue />
						</SelectTrigger>
						<SelectContent>
							{EXPORT_QUALITY_VALUES.map((quality) => (
								<SelectItem key={quality} value={`${QUALITY_PREFIX}${quality}`}>
									{`${EXPORT_QUALITY_LABELS[quality]} quality`}
								</SelectItem>
							))}
							{settings.videoBitrate.kind === "by-fps" && (
								<SelectItem value="by-fps">
									{`${settings.videoBitrate.mbpsUpTo30} / ${settings.videoBitrate.mbpsAbove30} Mbps (by fps)`}
								</SelectItem>
							)}
							<SelectItem value="custom">Custom (Mbps)</SelectItem>
						</SelectContent>
					</Select>
				</Field>

				{settings.videoBitrate.kind === "custom" && (
					<Field label="Mbps" htmlFor="export-mbps">
						<Input
							id="export-mbps"
							type="number"
							min={CUSTOM_MBPS_MIN}
							max={CUSTOM_MBPS_MAX}
							step={0.5}
							value={settings.videoBitrate.mbps}
							onChange={(event) => {
								const mbps = Number(event.target.value);
								if (Number.isFinite(mbps)) update({ videoBitrate: { kind: "custom", mbps } });
							}}
							onBlur={() => {
								if (settings.videoBitrate.kind !== "custom") return;
								const clamped = clampMbps(settings.videoBitrate.mbps);
								if (clamped !== settings.videoBitrate.mbps) {
									update({ videoBitrate: { kind: "custom", mbps: clamped } });
								}
							}}
						/>
					</Field>
				)}
			</div>

			<Section collapsible defaultOpen={false}>
				<SectionHeader>
					<SectionTitle>Advanced</SectionTitle>
				</SectionHeader>
				<SectionContent className="flex flex-col gap-2">
					<Field label="Bitrate mode">
						<Select
							value={settings.bitrateMode}
							onValueChange={(value) => {
								if (isOneOf(BITRATE_MODE_VALUES, value)) update({ bitrateMode: value });
							}}
						>
							<SelectTrigger className="h-8 w-full">
								<SelectValue />
							</SelectTrigger>
							<SelectContent>
								<SelectItem value="variable">Variable (VBR)</SelectItem>
								<SelectItem value="constant">Constant (CBR)</SelectItem>
							</SelectContent>
						</Select>
					</Field>
					<div className="flex items-center space-x-2">
						<Checkbox
							id="include-audio"
							checked={settings.includeAudio}
							onCheckedChange={(checked) => update({ includeAudio: !!checked })}
						/>
						<Label htmlFor="include-audio">Include audio</Label>
					</div>
					<Field label="Audio bitrate">
						<Select
							disabled={!settings.includeAudio}
							value={String(settings.audioBitrateKbps)}
							onValueChange={(value) => {
								const kbps = Number(value);
								if (isOneOf(AUDIO_BITRATE_KBPS_VALUES, kbps)) update({ audioBitrateKbps: kbps });
							}}
						>
							<SelectTrigger className="h-8 w-full">
								<SelectValue />
							</SelectTrigger>
							<SelectContent>
								{AUDIO_BITRATE_KBPS_VALUES.map((kbps) => (
									<SelectItem key={kbps} value={String(kbps)}>
										{`${kbps} kbps`}
									</SelectItem>
								))}
							</SelectContent>
						</Select>
					</Field>
					<div className="flex items-center space-x-2">
						<Checkbox
							id="hardware-encoding"
							checked={settings.hardwareEncoding}
							onCheckedChange={(checked) => update({ hardwareEncoding: !!checked })}
						/>
						<Label htmlFor="hardware-encoding">Hardware encoding (faster)</Label>
					</div>
				</SectionContent>
			</Section>

			<div className="flex flex-col gap-2 p-3">
				<p className="text-muted-foreground text-xs">{formatExportSummary({ params })}</p>
				{warnings.map((warning) => (
					<p key={warning} className="text-xs text-amber-500">
						{warning}
					</p>
				))}
				{isNaming ? (
					<div className="flex flex-col gap-1">
						<div className="flex gap-2">
							<Input
								autoFocus
								aria-label="Preset name"
								placeholder="Preset name"
								value={presetName}
								onChange={(event) => {
									setPresetName(event.target.value);
									setNameError(null);
								}}
								onKeyDown={(event) => {
									if (event.key === "Enter") savePreset();
								}}
							/>
							<Button size="sm" onClick={savePreset}>
								Save
							</Button>
							<Button
								size="sm"
								variant="ghost"
								onClick={() => {
									setIsNaming(false);
									setNameError(null);
								}}
							>
								Cancel
							</Button>
						</div>
						{nameError && <p className="text-destructive text-xs">{nameError}</p>}
					</div>
				) : (
					<Button
						size="sm"
						variant="ghost"
						className="self-start"
						onClick={() => setIsNaming(true)}
					>
						Save as preset…
					</Button>
				)}
			</div>
		</div>
	);
}
```

- [ ] **Step 2: Wire it into `export-button.tsx`**

**Remove from `ExportPopover`:**
- the `format`, `quality` and `shouldIncludeAudio` state;
- the `isExportFormat` and `isExportQuality` helpers;
- the three `<Section>` blocks (Format, Quality, Audio) inside `{!isExporting && (…)}`;
- imports that become unused: `RadioGroup`, `RadioGroupItem`, `Checkbox`, `Label`, `Section*`, `EXPORT_FORMAT_VALUES`, `EXPORT_QUALITY_VALUES`, the `ExportFormat` and `ExportQuality` types, and `DEFAULT_EXPORT_SETTINGS`.

**Add:**
```tsx
import { ExportSettingsForm } from "@/components/editor/export-settings-form";
import type { ExportSettings } from "@/export/settings";
```
```tsx
	const { exportFolder, setExportFolder, lastSettings, setLastSettings } =
		useExportSettingsStore();
	const [settings, setSettings] = useState<ExportSettings>(lastSettings);
```
This replaces the existing `useExportSettingsStore()` destructure line.

**In `handleExport`:**
- Use `settings.format` wherever `format` was used: `getExportFileExtension({ format: settings.format })`, `extension: settings.format`, and `getExportMimeType({ format: settings.format })`.
- Call `editor.project.export({ settings })`.
- After `if (result.success && result.buffer) {`, add `setLastSettings({ settings });` as the first line.

**Replace the removed sections** with:
```tsx
								<ExportSettingsForm
									settings={settings}
									onChange={setSettings}
									projectSize={activeProject.settings.canvasSize}
									projectFps={activeProject.settings.fps}
								/>
```
It goes where `<div className="flex flex-col">…three Sections…</div>` was. The save-folder and Export buttons block stays below it.

**Width:** change `PopoverContent` from `w-80` to `w-96`.

- [ ] **Step 3: Verify**

- `cd /d/OpenCut/apps/web && bunx tsc --noEmit 2>&1 | grep -c "error TS"` → `0`.
- `cd /d/OpenCut && bun test 2>&1 | grep -E "^\s*[0-9]+ (pass|fail)"` → no new failures.
- `cd /d/OpenCut && bun run build:web 2>&1 | tail -3` → succeeds.

- [ ] **Step 4: Commit** (no Co-Authored-By line)

```bash
cd /d/OpenCut && git add apps/web/src/components/editor && git commit -q -F - <<'EOF'
feat(export): preset picker and export settings in the export popover
EOF
```

---

## Task 5: Real export verification (controller)

- [ ] **Step 1:** Build. Run `bun run build:desktop`, then build the profiling exe with `bunx tauri build --debug --no-bundle --config /tmp/rcut-debug-config.json` from `apps/desktop`, then launch it.
- [ ] **Step 2:** Over CDP, find the editor (`window.__editor`) in a test project. For each case below:
  - call `window.__editor.project.export({ settings })`;
  - return the buffer as base64 and write it to the scratchpad;
  - run `ffprobe -v error -show_entries stream=codec_name,width,height,r_frame_rate,bit_rate -of json`.

  | Case | Expected |
  |---|---|
  | 1080p project → YouTube 4K + 60 fps | 3840×2160, 60/1, h264, ~60 Mbps |
  | → Small file | 1280×720, h264 |
  | 9:16 project → Shorts | 1080×1920 |
  | `hardwareEncoding: false` | still succeeds |
  | WebM + custom 20 Mbps | vp9 |
- [ ] **Step 3:** UI check by screenshot:
  - the preset dropdown, summary line and Shorts warning on a 16:9 project;
  - saving a preset, re-selecting it, and deleting it.
- [ ] **Step 4:** The user reviews in `rcut.exe`.
