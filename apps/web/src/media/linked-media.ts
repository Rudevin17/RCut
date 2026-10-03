import type { MediaAsset, MediaType } from "@/media/types";
import type {
	MediaAssetData,
	MissingMediaAsset,
} from "@/services/storage/types";

export type MediaImportPlan =
	| { mode: "link"; sourcePath: string }
	| { mode: "copy" };

export function planMediaImport({
	path,
}: {
	path: string | null;
}): MediaImportPlan {
	return path ? { mode: "link", sourcePath: path } : { mode: "copy" };
}

export function isRelinkCompatible({
	missingAsset,
	fileType,
}: {
	missingAsset: MissingMediaAsset;
	fileType: MediaType | null;
}): boolean {
	return fileType === missingAsset.type;
}

export function applyRelinkedAsset({
	assets,
	missingAssets,
	relinked,
}: {
	assets: MediaAsset[];
	missingAssets: MissingMediaAsset[];
	relinked: MediaAsset;
}): { assets: MediaAsset[]; missingAssets: MissingMediaAsset[] } {
	return {
		assets: [...assets.filter((asset) => asset.id !== relinked.id), relinked],
		missingAssets: missingAssets.filter((asset) => asset.id !== relinked.id),
	};
}

export function toMediaAssetData({
	missingAsset,
}: {
	missingAsset: MissingMediaAsset;
}): MediaAssetData {
	const { reason: _reason, ...metadata } = missingAsset;
	return metadata;
}
