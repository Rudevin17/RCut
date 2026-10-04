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
