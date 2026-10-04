import { describe, expect, test } from "bun:test";
import type { AudioMixClip } from "@/media/audio-export/plan";
import { mixClipIntoWindow, type PcmBlock } from "@/media/audio-export/mixer";

const clip = (patch: Partial<AudioMixClip> = {}): AudioMixClip => ({
	id: "c",
	sourceKey: "s",
	startTime: 0,
	duration: 1,
	trimStart: 0,
	rate: 1,
	maintainPitch: false,
	volume: 1,
	...patch,
});
// Source: value = sample index, so interpolation is easy to check.
const ramp = (length: number, sampleRate = 10, startTime = 0): PcmBlock => ({
	channels: [Float32Array.from({ length }, (_, i) => i)],
	sampleRate,
	startTime,
});
const out = (length: number): [Float32Array, Float32Array] => [new Float32Array(length), new Float32Array(length)];

describe("mixClipIntoWindow", () => {
	test("places the clip at its start and duplicates mono to both channels", () => {
		const output = out(10);
		mixClipIntoWindow({ clip: clip({ startTime: 0.2, duration: 0.3 }), block: ramp(20), window: { startSample: 0, endSample: 10 }, sampleRate: 10, output });
		expect(Array.from(output[0])).toEqual([0, 0, 0, 1, 2, 0, 0, 0, 0, 0]);
		expect(Array.from(output[1])).toEqual(Array.from(output[0]));
	});

	test("applies trimStart, rate and constant volume", () => {
		const output = out(4);
		mixClipIntoWindow({ clip: clip({ trimStart: 0.5, rate: 2, volume: 0.5 }), block: ramp(40), window: { startSample: 0, endSample: 4 }, sampleRate: 10, output });
		// source index = 5 + 2i → 5, 7, 9, 11, then × 0.5
		expect(Array.from(output[0])).toEqual([2.5, 3.5, 4.5, 5.5]);
	});

	test("interpolates between source samples when rates differ", () => {
		const output = out(2);
		mixClipIntoWindow({ clip: clip(), block: ramp(10, 5), window: { startSample: 0, endSample: 2 }, sampleRate: 10, output });
		// output sample 1 → clipTime 0.1 s → source index 0.5
		expect(Array.from(output[0])).toEqual([0, 0.5]);
	});

	test("uses the block's start time to locate source samples", () => {
		const output = out(2);
		mixClipIntoWindow({ clip: clip({ trimStart: 3 }), block: ramp(10, 10, 2), window: { startSample: 0, endSample: 2 }, sampleRate: 10, output });
		// source time 3.0 → block index 10 → beyond the block (length 10) → nothing mixed
		expect(Array.from(output[0])).toEqual([0, 0]);
		const inside = out(2);
		mixClipIntoWindow({ clip: clip({ trimStart: 2.5 }), block: ramp(10, 10, 2), window: { startSample: 0, endSample: 2 }, sampleRate: 10, output: inside });
		expect(Array.from(inside[0])).toEqual([5, 6]);
	});

	test("keyframed gain is evaluated per sample at clip time", () => {
		const output = out(3);
		mixClipIntoWindow({ clip: clip({ gainAt: (clipTime) => clipTime * 10 }), block: { channels: [new Float32Array(10).fill(1)], sampleRate: 10, startTime: 0 }, window: { startSample: 0, endSample: 3 }, sampleRate: 10, output });
		expect(Array.from(output[0]).map((v) => Math.round(v * 1000) / 1000)).toEqual([0, 1, 2]);
	});

	test("mixing across two windows equals mixing in one window", () => {
		const block = ramp(100);
		const c = clip({ startTime: 0.3, duration: 0.9, trimStart: 1, rate: 1.5, volume: 0.7 });
		const whole = out(20);
		mixClipIntoWindow({ clip: c, block, window: { startSample: 0, endSample: 20 }, sampleRate: 10, output: whole });
		const first = out(7);
		const second = out(13);
		mixClipIntoWindow({ clip: c, block, window: { startSample: 0, endSample: 7 }, sampleRate: 10, output: first });
		mixClipIntoWindow({ clip: c, block, window: { startSample: 7, endSample: 20 }, sampleRate: 10, output: second });
		expect([...first[0], ...second[0]]).toEqual(Array.from(whole[0]));
	});

	test("uses the first two channels of a multichannel source", () => {
		const output = out(1);
		const block: PcmBlock = { channels: [new Float32Array([1]), new Float32Array([2]), new Float32Array([3])], sampleRate: 10, startTime: 0 };
		mixClipIntoWindow({ clip: clip({ duration: 0.1 }), block, window: { startSample: 0, endSample: 1 }, sampleRate: 10, output });
		expect([output[0][0], output[1][0]]).toEqual([1, 2]);
	});
});
