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
