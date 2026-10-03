import { describe, expect, test } from "bun:test";
import {
	applyRelinkedAsset,
	isRelinkCompatible,
	planMediaImport,
	toMediaAssetData,
} from "@/media/linked-media";
import type { MediaAsset } from "@/media/types";
import type { MissingMediaAsset } from "@/services/storage/types";

const missingVideo: MissingMediaAsset = {
	id: "m1",
	name: "clip.mp4",
	type: "video",
	size: 10,
	lastModified: 1,
	sourcePath: "D:\old\clip.mp4",
	reason: "missing",
};

function asset({ id }: { id: string }): MediaAsset {
	return {
		id,
		name: `${id}.mp4`,
		type: "video",
		file: new File(["x"], `${id}.mp4`, { type: "video/mp4" }),
	};
}

describe("planMediaImport", () => {
	test("links files that have a path", () => {
		expect(planMediaImport({ path: "D:\a.mp4" })).toEqual({
			mode: "link",
			sourcePath: "D:\a.mp4",
		});
	});

	test("copies files without a path", () => {
		expect(planMediaImport({ path: null })).toEqual({ mode: "copy" });
	});
});

describe("isRelinkCompatible", () => {
	test("accepts the same media type", () => {
		expect(
			isRelinkCompatible({ missingAsset: missingVideo, fileType: "video" }),
		).toBe(true);
	});

	test("rejects a different or unknown media type", () => {
		expect(
			isRelinkCompatible({ missingAsset: missingVideo, fileType: "image" }),
		).toBe(false);
		expect(
			isRelinkCompatible({ missingAsset: missingVideo, fileType: null }),
		).toBe(false);
	});
});

describe("applyRelinkedAsset", () => {
	test("moves the asset from missing to loaded", () => {
		const other = asset({ id: "a1" });
		const relinked = asset({ id: "m1" });
		const result = applyRelinkedAsset({
			assets: [other],
			missingAssets: [missingVideo],
			relinked,
		});
		expect(result.assets).toEqual([other, relinked]);
		expect(result.missingAssets).toEqual([]);
	});
});

describe("toMediaAssetData", () => {
	test("drops the missing reason and keeps the link", () => {
		expect(toMediaAssetData({ missingAsset: missingVideo })).toEqual({
			id: "m1",
			name: "clip.mp4",
			type: "video",
			size: 10,
			lastModified: 1,
			sourcePath: "D:\old\clip.mp4",
		});
	});
});
