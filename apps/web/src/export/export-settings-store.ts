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
			version: 2,
			migrate: (persisted) => migrateExportSettingsState({ persisted }),
		},
	),
);
