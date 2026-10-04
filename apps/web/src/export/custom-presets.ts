import { BUILT_IN_EXPORT_PRESETS } from "@/export/presets";
import {
	AUDIO_BITRATE_KBPS_VALUES,
	DEFAULT_EXPORT_SETTINGS,
	type ExportSettings,
} from "@/export/settings";

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

/** Older stored values (such as 320 kbps) are no longer offered, so they fall back to the default. */
function withSupportedAudioBitrate({ settings }: { settings: ExportSettings }): ExportSettings {
	if (AUDIO_BITRATE_KBPS_VALUES.includes(settings.audioBitrateKbps)) return settings;
	return { ...settings, audioBitrateKbps: DEFAULT_EXPORT_SETTINGS.audioBitrateKbps };
}

/** Brings any older stored export state up to the current shape. */
export function migrateExportSettingsState({
	persisted,
}: {
	persisted: unknown;
}): PersistedExportSettings {
	const state = isRecord(persisted) ? persisted : {};
	const lastSettings = isRecord(state.lastSettings) ? state.lastSettings : {};
	const customPresets = Array.isArray(state.customPresets)
		? (state.customPresets as CustomExportPreset[])
		: [];
	return {
		exportFolder: typeof state.exportFolder === "string" ? state.exportFolder : null,
		lastSettings: withSupportedAudioBitrate({
			settings: { ...DEFAULT_EXPORT_SETTINGS, ...(lastSettings as Partial<ExportSettings>) },
		}),
		customPresets: customPresets.map((preset) => ({
			...preset,
			settings: withSupportedAudioBitrate({ settings: preset.settings }),
		})),
	};
}
