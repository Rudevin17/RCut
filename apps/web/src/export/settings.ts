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
}

export const DEFAULT_EXPORT_SETTINGS: ExportSettings = {
	format: "mp4",
	resolution: "project",
	frameRate: "project",
	videoBitrate: { kind: "quality", quality: "high" },
	bitrateMode: "variable",
	includeAudio: true,
	audioBitrateKbps: 192,
};
