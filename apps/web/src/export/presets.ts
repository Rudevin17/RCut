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
