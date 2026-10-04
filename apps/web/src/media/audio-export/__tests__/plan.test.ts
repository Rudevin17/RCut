import { describe, expect, test } from "bun:test";
import {
	type AudioMixClip,
	getChunkWindow,
	getClipSampleRange,
	getClipSourceRange,
} from "@/media/audio-export/plan";

const clip = (patch: Partial<AudioMixClip> = {}): AudioMixClip => ({
	id: "c",
	sourceKey: "s",
	startTime: 1,
	duration: 2,
	trimStart: 5,
	rate: 1,
	maintainPitch: false,
	volume: 1,
	...patch,
});

describe("getClipSampleRange", () => {
	test("floors the start and ceils the length", () => {
		expect(getClipSampleRange({ clip: clip({ startTime: 0.5, duration: 0.25 }), sampleRate: 10 })).toEqual({ start: 5, end: 8 });
		expect(getClipSampleRange({ clip: clip({ startTime: 0.55, duration: 0.21 }), sampleRate: 10 })).toEqual({ start: 5, end: 8 });
	});
});

describe("getClipSourceRange", () => {
	test("returns null when the clip does not overlap the window", () => {
		expect(getClipSourceRange({ clip: clip(), window: { startSample: 0, endSample: 10 }, sampleRate: 10 })).toBeNull();
		expect(getClipSourceRange({ clip: clip(), window: { startSample: 30, endSample: 40 }, sampleRate: 10 })).toBeNull();
	});

	test("maps the overlapping part to source seconds, including rate", () => {
		// Clip covers timeline samples [10, 30). Window [20, 40) overlaps [20, 30) → clip time [1, 2).
		expect(getClipSourceRange({ clip: clip(), window: { startSample: 20, endSample: 40 }, sampleRate: 10 })).toEqual({ sourceStart: 6, sourceEnd: 7 });
		expect(getClipSourceRange({ clip: clip({ rate: 2 }), window: { startSample: 20, endSample: 40 }, sampleRate: 10 })).toEqual({ sourceStart: 7, sourceEnd: 9 });
	});
});

describe("getChunkWindow", () => {
	test("splits the timeline and clips the last window", () => {
		expect(getChunkWindow({ index: 0, totalSamples: 25, chunkSamples: 10 })).toEqual({ startSample: 0, endSample: 10 });
		expect(getChunkWindow({ index: 2, totalSamples: 25, chunkSamples: 10 })).toEqual({ startSample: 20, endSample: 25 });
		expect(getChunkWindow({ index: 3, totalSamples: 25, chunkSamples: 10 })).toBeNull();
	});
});
