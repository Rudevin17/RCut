import { create } from "zustand";
import { parseCubeLut, type LutData, type Rgb } from "@/luts/cube-parser";
import { getBuiltinLut, isBuiltinLutId } from "@/luts/builtin-looks";
import { IndexedDBAdapter } from "@/services/storage/indexeddb-adapter";

interface LutRecord {
	id: string;
	name: string;
	size: number;
	domainMin: Rgb;
	domainMax: Rgb;
	data: Float32Array;
	importedAt: number;
}

export interface LutLibraryEntry {
	id: string;
	name: string;
}

// The adapter opens the database lazily, so importing this module never touches IndexedDB.
const storage = new IndexedDBAdapter<LutRecord>({ dbName: "rcut-luts", storeName: "luts" });
const records = new Map<string, LutRecord>();

/** Resolves a built-in look or an imported LUT. Synchronous: imported LUTs must be loaded first. */
export function getLut({ id }: { id: string }): LutData | null {
	return isBuiltinLutId(id) ? getBuiltinLut({ id }) : (records.get(id) ?? null);
}

function sortedEntries(): LutLibraryEntry[] {
	return [...records.values()]
		.map(({ id, name }) => ({ id, name }))
		.sort((a, b) => a.name.localeCompare(b.name));
}

interface LutLibraryState {
	luts: LutLibraryEntry[];
	loaded: boolean;
	load(): Promise<void>;
	importFile(args: { file: File }): Promise<string>;
	remove(args: { id: string }): Promise<void>;
}

export const useLutLibrary = create<LutLibraryState>()((set, get) => ({
	luts: [],
	loaded: false,

	load: async () => {
		if (get().loaded) return;
		for (const record of await storage.getAll()) {
			records.set(record.id, record);
		}
		set({ luts: sortedEntries(), loaded: true });
	},

	importFile: async ({ file }) => {
		const parsed = parseCubeLut({ text: await file.text() });
		const record: LutRecord = {
			id: crypto.randomUUID(),
			name: parsed.title ?? file.name.replace(/\.cube$/i, ""),
			size: parsed.size,
			domainMin: parsed.domainMin,
			domainMax: parsed.domainMax,
			data: parsed.data,
			importedAt: Date.now(),
		};
		await storage.set({ key: record.id, value: record });
		records.set(record.id, record);
		set({ luts: sortedEntries() });
		return record.id;
	},

	remove: async ({ id }) => {
		await storage.remove(id);
		records.delete(id);
		set({ luts: sortedEntries() });
	},
}));
