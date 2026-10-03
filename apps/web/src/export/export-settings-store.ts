"use client";

import { create } from "zustand";
import { persist } from "zustand/middleware";

interface ExportSettingsState {
	exportFolder: string | null;
	setExportFolder: ({ folder }: { folder: string }) => void;
}

export const useExportSettingsStore = create<ExportSettingsState>()(
	persist(
		(set) => ({
			exportFolder: null,
			setExportFolder: ({ folder }) => set({ exportFolder: folder }),
		}),
		{ name: "rcut-export-settings" },
	),
);
