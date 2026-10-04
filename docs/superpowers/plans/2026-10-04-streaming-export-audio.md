# Streaming Export Audio Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Export audio is mixed in roughly 10-second windows while the video encodes. Each window decodes only the source ranges it needs, so memory stays bounded for any timeline length and the export can be cancelled at any point.

**Architecture:**
- Pure plan and mixer modules work on plain `Float32Array` PCM blocks and are unit-tested.
- A browser-only source reader uses mediabunny `AudioBufferSink.buffers(start, end)`.
- A `TimelineAudioStream` yields mixed, mastered `AudioBuffer` chunks.
- `SceneExporter` feeds the chunks to its `AudioBufferSource` one window ahead of the video, under the existing stall and cancel guard.
- `createTimelineAudioBuffer`, which transcription uses, is rebuilt on top of the same stream.

**Tech Stack:** TypeScript, mediabunny 1.41 (`Input`, `BlobSource`, `AudioBufferSink`, `AudioBufferSource`), Web Audio `OfflineAudioContext`, bun:test.

**Spec:** `docs/superpowers/specs/2026-10-04-streaming-export-audio-design.md`

## Global Constraints

**Repo and commits**
- The repo is `D:\OpenCut`, on branch `main`.
- **Commit messages must NOT contain any Co-Authored-By line or Claude attribution.**

**Editing and code style**
- Change files only with the Edit/Write tools. No `sed -i`, scripts or heredocs for files; a heredoc for `git commit -F -` is fine.
- TypeScript uses tabs, double quotes and object-parameter functions.
- Tests use `bun:test` and live in `__tests__/`.
- Pure modules must not import `opencut-wasm`, mediabunny or Web Audio at runtime. Type-only imports are fine. bun has no `AudioBuffer` and no WASM.

**Commands and baselines**
- Tests: `cd /d/OpenCut && bun test`. The baseline is 278 pass / 4 fail; those 4 are pre-existing `wasm.__wbindgen_start` failures.
- Typecheck: `cd /d/OpenCut/apps/web && bunx tsc --noEmit 2>&1 | grep -c "error TS"` → `0`.
- Build: `cd /d/OpenCut && bun run build:web`.

**Fixed values**
- Export mix rate: `EXPORT_SAMPLE_RATE = 44100`, stereo.
- `CHUNK_SECONDS = 10`.
- Mastering pre-roll: `0.25` s.
- Reader margin: `0.05` s on each side of a requested source range.
- Clip placement: `startSample = Math.floor(startTime * sr)` and `length = Math.ceil(duration * sr)`, the same as the current `mixAudioChannels`.
- Timeline length in samples: `Math.ceil(durationSeconds * sr)`.

**Mix maths (preserve exactly)**
- `sourceTime = trimStart + clipTime * rate`.
- Linear interpolation at the block's sample rate.
- Gain: `gainAt(clipTime)` when the volume is keyframed, otherwise `volume`.
- Output channel `c` reads source channel `min(c, channels - 1)`.

---

## Task 1: Pure plan and mixer

**Files:**
- Create: `apps/web/src/media/audio-export/plan.ts`
- Create: `apps/web/src/media/audio-export/mixer.ts`
- Test: `apps/web/src/media/audio-export/__tests__/plan.test.ts`
- Test: `apps/web/src/media/audio-export/__tests__/mixer.test.ts`

**Interfaces it produces (later tasks use these exact names):**
- `plan.ts`:
  - `CHUNK_SECONDS`
  - `interface AudioMixClip { id; sourceKey; startTime; duration; trimStart; rate; maintainPitch; volume; gainAt? }`
  - `interface SampleWindow { startSample; endSample }`
  - `getClipSampleRange({ clip, sampleRate }) → { start; end }`
  - `getClipSourceRange({ clip, window, sampleRate }) → { sourceStart; sourceEnd } | null`
  - `getChunkWindow({ index, totalSamples, chunkSamples }) → SampleWindow | null`
- `mixer.ts`:
  - `interface PcmBlock { channels: Float32Array[]; sampleRate: number; startTime: number }`
  - `mixClipIntoWindow({ clip, block, window, sampleRate, output })`

- [ ] **Step 1: Write the failing tests**

`apps/web/src/media/audio-export/__tests__/plan.test.ts`:
```ts
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
```

`apps/web/src/media/audio-export/__tests__/mixer.test.ts`:
```ts
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
```

- [ ] **Step 2: Run the tests and confirm they fail**

Run: `cd /d/OpenCut && bun test apps/web/src/media/audio-export/__tests__/`

Expected: FAIL. The modules don't exist yet.

- [ ] **Step 3: Implement `plan.ts`**

```ts
/** Length of one streamed audio window, in seconds. */
export const CHUNK_SECONDS = 10;

/** One audible timeline clip, in seconds, ready for mixing. */
export interface AudioMixClip {
	id: string;
	/** Identifies the decoded source (media asset id, or element id for library audio). */
	sourceKey: string;
	/** Timeline position. */
	startTime: number;
	/** Timeline duration. */
	duration: number;
	/** Source time at the clip's start. */
	trimStart: number;
	/** Source seconds per clip second (1 = normal speed). */
	rate: number;
	/** Pitch-preserving speed change: the clip is pre-rendered, then mixed at rate 1 from 0. */
	maintainPitch: boolean;
	/** Gain when the volume is not keyframed. */
	volume: number;
	/** Gain at a clip time, when the volume is keyframed. */
	gainAt?: (clipTime: number) => number;
}

/** A half-open range of timeline samples at the mix rate. */
export interface SampleWindow {
	startSample: number;
	endSample: number;
}

export function getClipSampleRange({
	clip,
	sampleRate,
}: {
	clip: AudioMixClip;
	sampleRate: number;
}): { start: number; end: number } {
	const start = Math.floor(clip.startTime * sampleRate);
	return { start, end: start + Math.ceil(clip.duration * sampleRate) };
}

/** The source seconds a clip needs to fill its part of `window`, or null if it doesn't overlap. */
export function getClipSourceRange({
	clip,
	window,
	sampleRate,
}: {
	clip: AudioMixClip;
	window: SampleWindow;
	sampleRate: number;
}): { sourceStart: number; sourceEnd: number } | null {
	const range = getClipSampleRange({ clip, sampleRate });
	const from = Math.max(range.start, window.startSample);
	const to = Math.min(range.end, window.endSample);
	if (from >= to) return null;
	const clipTimeFrom = (from - range.start) / sampleRate;
	const clipTimeTo = (to - range.start) / sampleRate;
	return {
		sourceStart: clip.trimStart + clipTimeFrom * clip.rate,
		sourceEnd: clip.trimStart + clipTimeTo * clip.rate,
	};
}

export function getChunkWindow({
	index,
	totalSamples,
	chunkSamples,
}: {
	index: number;
	totalSamples: number;
	chunkSamples: number;
}): SampleWindow | null {
	const startSample = index * chunkSamples;
	if (startSample >= totalSamples) return null;
	return { startSample, endSample: Math.min(totalSamples, startSample + chunkSamples) };
}
```

- [ ] **Step 4: Implement `mixer.ts`**

```ts
import { getClipSampleRange, type AudioMixClip, type SampleWindow } from "@/media/audio-export/plan";

/** Decoded source audio: planar channels starting at `startTime` source seconds. */
export interface PcmBlock {
	channels: Float32Array[];
	sampleRate: number;
	startTime: number;
}

/** Adds one clip's audio for `window` into `output` (two channels, window-relative). */
export function mixClipIntoWindow({
	clip,
	block,
	window,
	sampleRate,
	output,
}: {
	clip: AudioMixClip;
	block: PcmBlock;
	window: SampleWindow;
	sampleRate: number;
	output: [Float32Array, Float32Array];
}): void {
	if (block.channels.length === 0) return;
	const range = getClipSampleRange({ clip, sampleRate });
	const from = Math.max(range.start, window.startSample);
	const to = Math.min(range.end, window.endSample);
	const blockLength = block.channels[0].length;

	for (let channel = 0; channel < 2; channel++) {
		const outputData = output[channel];
		const sourceData = block.channels[Math.min(channel, block.channels.length - 1)];
		for (let sample = from; sample < to; sample++) {
			const clipTime = (sample - range.start) / sampleRate;
			const sourceTime = clip.trimStart + clipTime * clip.rate;
			const sourceIndex = (sourceTime - block.startTime) * block.sampleRate;
			if (sourceIndex < 0) continue;
			if (sourceIndex >= blockLength) break;
			const lowerIndex = Math.floor(sourceIndex);
			const upperIndex = Math.min(blockLength - 1, lowerIndex + 1);
			const fraction = sourceIndex - lowerIndex;
			const gain = clip.gainAt ? clip.gainAt(clipTime) : clip.volume;
			outputData[sample - window.startSample] +=
				(sourceData[lowerIndex] * (1 - fraction) + sourceData[upperIndex] * fraction) * gain;
		}
	}
}
```

- [ ] **Step 5: Run the tests and confirm they pass**

Run: `cd /d/OpenCut && bun test apps/web/src/media/audio-export/__tests__/` → all pass.
Run the typecheck → `0`.

- [ ] **Step 6: Commit** (no Co-Authored-By)

```bash
cd /d/OpenCut && git add apps/web/src/media/audio-export && git commit -q -F - <<'EOF'
feat(audio): pure windowed audio mix plan and mixer
EOF
```

---

## Task 2: Source reader, timeline audio stream, transcription path

**Files:**
- Create: `apps/web/src/media/audio-export/source-reader.ts`
- Create: `apps/web/src/media/audio-export/timeline-audio-stream.ts`
- Modify: `apps/web/src/media/audio.ts`
  - Rebuild `createTimelineAudioBuffer` on the stream and drop its `audioContext` parameter.
  - Remove the whole-file decode path once nothing uses it: `collectAudioElements`, `resolveAudioBufferForElement`, `resolveAudioBufferForAsset`, `mixAudioChannels`, `CollectedAudioElement`. Grep first and keep anything still used elsewhere.
- Modify: `apps/web/src/media/audio-mastering.ts`: export `clampAudioBufferPeak` and `MASTER_OUTPUT_HEADROOM`.

**Interfaces:**
- Consumes the Task 1 names. It also uses these existing functions:
  - `collectAudibleCandidates({ tracks, mediaAssets })` (`media/audio.ts`);
  - `isElementMuted`, `hasAnimatedVolume`, `resolveEffectiveAudioGain` (`timeline/audio-state.ts`; `localTime` is in clip seconds);
  - `shouldMaintainPitch({ rate, maintainPitch })` (`retime/rate.ts`);
  - `renderRetimedBuffer({ audioContext, sourceBuffer, trimStart, clipDuration, retime, maintainPitch })` (`retime/audio-stretch.ts`);
  - `createAudioMasteringChain({ audioContext, destination })` (`media/audio-mastering.ts`);
  - `TICKS_PER_SECOND` (`@/wasm`).
- Produces:
  - `class AudioSourceReader`:
    - `static async open({ file }): Promise<AudioSourceReader | null>`, which returns null when the file has no audio track;
    - `read({ start, end }): Promise<PcmBlock | null>`;
    - `dispose(): void`.
  - `class TimelineAudioStream`:
    - `static async create({ tracks, mediaAssets, duration, sampleRate }): Promise<TimelineAudioStream | null>`. `duration` is in ticks. It returns null when no clip is audible.
    - Read-only properties: `sampleRate`, `numberOfChannels` (2), `totalSamples`, `renderedSamples`, `done`, `chunkSeconds`.
    - `nextChunk(): Promise<AudioBuffer | null>`: a mixed and mastered chunk, or null when finished.
    - `reset(): void`: rewinds to the start.
    - `dispose(): void`.

- [ ] **Step 1: `source-reader.ts`**

```ts
import { ALL_FORMATS, AudioBufferSink, BlobSource, Input } from "mediabunny";
import type { PcmBlock } from "@/media/audio-export/mixer";

const READ_MARGIN_SECONDS = 0.05;
const MAX_CHANNELS = 2;

/** Keeps one source file open and decodes only the audio ranges asked for. */
export class AudioSourceReader {
	private constructor(
		private readonly input: Input,
		private readonly sink: AudioBufferSink,
	) {}

	static async open({ file }: { file: Blob }): Promise<AudioSourceReader | null> {
		const input = new Input({ source: new BlobSource(file), formats: ALL_FORMATS });
		const track = await input.getPrimaryAudioTrack();
		if (!track) {
			input.dispose();
			return null;
		}
		return new AudioSourceReader(input, new AudioBufferSink(track));
	}

	/** Decodes source seconds [start, end] (plus a small margin) into planar channels. */
	async read({ start, end }: { start: number; end: number }): Promise<PcmBlock | null> {
		const pieces: AudioBuffer[] = [];
		let startTime: number | null = null;
		for await (const { buffer, timestamp } of this.sink.buffers(
			Math.max(0, start - READ_MARGIN_SECONDS),
			end + READ_MARGIN_SECONDS,
		)) {
			if (startTime === null) startTime = timestamp;
			pieces.push(buffer);
		}
		if (startTime === null || pieces.length === 0) return null;

		const channelCount = Math.min(MAX_CHANNELS, pieces[0].numberOfChannels);
		const length = pieces.reduce((total, piece) => total + piece.length, 0);
		const channels = Array.from({ length: channelCount }, () => new Float32Array(length));
		let offset = 0;
		for (const piece of pieces) {
			for (let channel = 0; channel < channelCount; channel++) {
				channels[channel].set(
					piece.getChannelData(Math.min(channel, piece.numberOfChannels - 1)),
					offset,
				);
			}
			offset += piece.length;
		}
		return { channels, sampleRate: pieces[0].sampleRate, startTime };
	}

	dispose(): void {
		this.input.dispose();
	}
}
```

- [ ] **Step 2: `timeline-audio-stream.ts`**

```ts
import type { SceneTracks } from "@/timeline";
import type { MediaAsset } from "@/media/types";
import { collectAudibleCandidates } from "@/media/audio";
import {
	clampAudioBufferPeak,
	createAudioMasteringChain,
	MASTER_OUTPUT_HEADROOM,
} from "@/media/audio-mastering";
import {
	CHUNK_SECONDS,
	getChunkWindow,
	getClipSourceRange,
	type AudioMixClip,
} from "@/media/audio-export/plan";
import { mixClipIntoWindow, type PcmBlock } from "@/media/audio-export/mixer";
import { AudioSourceReader } from "@/media/audio-export/source-reader";
import { hasAnimatedVolume, isElementMuted, resolveEffectiveAudioGain } from "@/timeline/audio-state";
import { shouldMaintainPitch } from "@/retime/rate";
import { renderRetimedBuffer } from "@/retime";
import { TICKS_PER_SECOND } from "@/wasm";

const PRE_ROLL_SECONDS = 0.25;
const CHANNELS = 2;

type ClipSource =
	| { kind: "reader"; reader: AudioSourceReader }
	| { kind: "block"; block: PcmBlock };

/** Streams the timeline's audio as mixed, mastered windows of CHUNK_SECONDS. */
export class TimelineAudioStream {
	readonly numberOfChannels = CHANNELS;
	readonly chunkSeconds = CHUNK_SECONDS;
	private chunkIndex = 0;
	private preRoll: Float32Array[] = [new Float32Array(0), new Float32Array(0)];

	private constructor(
		readonly sampleRate: number,
		readonly totalSamples: number,
		private readonly clips: Array<{ clip: AudioMixClip; source: ClipSource }>,
		private readonly readers: AudioSourceReader[],
	) {}

	static async create({
		tracks,
		mediaAssets,
		duration,
		sampleRate,
	}: {
		tracks: SceneTracks;
		mediaAssets: MediaAsset[];
		duration: number;
		sampleRate: number;
	}): Promise<TimelineAudioStream | null> {
		const readersByKey = new Map<string, AudioSourceReader | null>();
		const clips: Array<{ clip: AudioMixClip; source: ClipSource }> = [];

		for (const { element, mediaAsset } of collectAudibleCandidates({ tracks, mediaAssets })) {
			if (isElementMuted({ element })) continue;
			const file = await resolveSourceFile({ element, mediaAsset });
			if (!file) continue;
			const sourceKey = mediaAsset?.id ?? element.id;
			if (!readersByKey.has(sourceKey)) {
				readersByKey.set(sourceKey, await AudioSourceReader.open({ file: file.blob }));
			}
			const reader = readersByKey.get(sourceKey);
			if (!reader) continue;

			const rate = element.retime?.rate ?? 1;
			const clip: AudioMixClip = {
				id: element.id,
				sourceKey,
				startTime: element.startTime / TICKS_PER_SECOND,
				duration: element.duration / TICKS_PER_SECOND,
				trimStart: element.trimStart / TICKS_PER_SECOND,
				rate,
				maintainPitch: shouldMaintainPitch({ rate, maintainPitch: element.retime?.maintainPitch }),
				volume: resolveEffectiveAudioGain({ element, localTime: 0 }),
				gainAt: hasAnimatedVolume({ element })
					? (clipTime) => resolveEffectiveAudioGain({ element, localTime: clipTime })
					: undefined,
			};

			if (clip.maintainPitch) {
				const block = await prerenderPitchedClip({ clip, reader, sampleRate, retime: element.retime });
				if (block) clips.push({ clip: { ...clip, trimStart: 0, rate: 1 }, source: { kind: "block", block } });
				continue;
			}
			clips.push({ clip, source: { kind: "reader", reader } });
		}

		const readers = [...readersByKey.values()].filter((reader): reader is AudioSourceReader => !!reader);
		if (clips.length === 0) {
			for (const reader of readers) reader.dispose();
			return null;
		}
		const totalSamples = Math.ceil((duration / TICKS_PER_SECOND) * sampleRate);
		return new TimelineAudioStream(sampleRate, totalSamples, clips, readers);
	}

	get renderedSamples(): number {
		return Math.min(this.totalSamples, this.chunkIndex * this.chunkSamples);
	}

	get done(): boolean {
		return this.renderedSamples >= this.totalSamples;
	}

	private get chunkSamples(): number {
		return Math.round(CHUNK_SECONDS * this.sampleRate);
	}

	reset(): void {
		this.chunkIndex = 0;
		this.preRoll = [new Float32Array(0), new Float32Array(0)];
	}

	async nextChunk(): Promise<AudioBuffer | null> {
		const window = getChunkWindow({
			index: this.chunkIndex,
			totalSamples: this.totalSamples,
			chunkSamples: this.chunkSamples,
		});
		if (!window) return null;
		this.chunkIndex++;

		const length = window.endSample - window.startSample;
		const output: [Float32Array, Float32Array] = [new Float32Array(length), new Float32Array(length)];
		for (const { clip, source } of this.clips) {
			const range = getClipSourceRange({ clip, window, sampleRate: this.sampleRate });
			if (!range) continue;
			const block =
				source.kind === "block"
					? source.block
					: await source.reader.read({ start: range.sourceStart, end: range.sourceEnd });
			if (!block) continue;
			mixClipIntoWindow({ clip, block, window, sampleRate: this.sampleRate, output });
		}

		const mastered = await this.master({ output });
		const preRollSamples = Math.round(PRE_ROLL_SECONDS * this.sampleRate);
		this.preRoll = output.map((channel) => channel.slice(Math.max(0, channel.length - preRollSamples)));
		return mastered;
	}

	/** Runs the master limiter over [previous pre-roll + this window] and keeps only this window. */
	private async master({ output }: { output: Float32Array[] }): Promise<AudioBuffer> {
		const preLength = this.preRoll[0].length;
		const length = output[0].length;
		const context = new OfflineAudioContext(CHANNELS, preLength + length, this.sampleRate);
		const input = context.createBuffer(CHANNELS, preLength + length, this.sampleRate);
		for (let channel = 0; channel < CHANNELS; channel++) {
			const data = input.getChannelData(channel);
			data.set(this.preRoll[channel], 0);
			data.set(output[channel], preLength);
		}
		const source = context.createBufferSource();
		source.buffer = input;
		const { input: chainInput } = createAudioMasteringChain({ audioContext: context, destination: context.destination });
		source.connect(chainInput);
		source.start(0);
		const rendered = await context.startRendering();

		const chunk = new AudioBuffer({ numberOfChannels: CHANNELS, length, sampleRate: this.sampleRate });
		for (let channel = 0; channel < CHANNELS; channel++) {
			chunk.copyToChannel(rendered.getChannelData(channel).subarray(preLength), channel);
		}
		clampAudioBufferPeak({ audioBuffer: chunk, maxPeak: MASTER_OUTPUT_HEADROOM });
		return chunk;
	}

	dispose(): void {
		for (const reader of this.readers) reader.dispose();
	}
}
```

You also need two helpers in this file:
- **`resolveSourceFile({ element, mediaAsset }): Promise<{ blob: Blob } | null>`**
  - For video elements and uploaded audio elements, return `{ blob: mediaAsset.file }`.
  - For library audio elements (`element.type === "audio" && element.sourceType !== "upload"`), `fetch(element.sourceUrl)` and return the response blob. Return `null` if the fetch fails, with `console.warn`.
  - Read `timeline/types.ts` for the exact element types, and `media/audio.ts` (`fetchLibraryAudioSource`) for the existing fetch.
- **`prerenderPitchedClip({ clip, reader, sampleRate, retime }): Promise<PcmBlock | null>`**
  1. Read the clip's whole used source range, `[clip.trimStart, clip.trimStart + clip.duration * clip.rate]`.
  2. Copy it into an `AudioBuffer` at the block's sample rate.
  3. Call `renderRetimedBuffer` with `trimStart` set to the clip's trim start minus the block's `startTime`, `clipDuration: clip.duration`, `retime`, and `maintainPitch: true`. For `audioContext`, pass `new OfflineAudioContext(CHANNELS, 1, sampleRate)`; it only supplies the target sample rate.
  4. Return `{ channels, sampleRate, startTime: 0 }` built from the rendered buffer's channels.

  Read `retime/audio-stretch.ts` first so you call it correctly.

- [ ] **Step 3: Rebuild `createTimelineAudioBuffer` in `media/audio.ts`**

```ts
export async function createTimelineAudioBuffer({
	tracks,
	mediaAssets,
	duration,
	sampleRate = EXPORT_SAMPLE_RATE,
}: {
	tracks: SceneTracks;
	mediaAssets: MediaAsset[];
	duration: number;
	sampleRate?: number;
}): Promise<AudioBuffer | null> {
	const stream = await TimelineAudioStream.create({ tracks, mediaAssets, duration, sampleRate });
	if (!stream) return null;
	try {
		const output = new AudioBuffer({
			numberOfChannels: stream.numberOfChannels,
			length: Math.max(1, stream.totalSamples),
			sampleRate,
		});
		let offset = 0;
		for (let chunk = await stream.nextChunk(); chunk; chunk = await stream.nextChunk()) {
			for (let channel = 0; channel < stream.numberOfChannels; channel++) {
				output.copyToChannel(chunk.getChannelData(channel), channel, offset);
			}
			offset += chunk.length;
		}
		return output;
	} finally {
		stream.dispose();
	}
}
```

- Export `EXPORT_SAMPLE_RATE` from `media/audio.ts`, because Task 3 uses it.
- `media/mediabunny.ts` already calls `createTimelineAudioBuffer` without `audioContext`, so check that it still compiles.
- Remove the now-unused whole-file path. Grep each name before deleting it.
- **Circular import check:** `timeline-audio-stream.ts` imports `collectAudibleCandidates` from `media/audio.ts`, and `media/audio.ts` imports `TimelineAudioStream`. If tsc or the bundler complains, move `collectAudibleCandidates` into `media/audio-export/candidates.ts` and re-export it from `media/audio.ts`.

- [ ] **Step 4: Verify**

- Run tsc → `0`.
- Run root `bun test` → no new failures, plus the Task 1 tests.
- Run `build:web` → succeeds.

There are no unit tests for these browser-only files. Task 4 covers them with real exports.

- [ ] **Step 5: Commit** (no Co-Authored-By)

`feat(audio): stream timeline audio in decoded-on-demand windows`

---

## Task 3: Exporter streams audio alongside video

**Files:**
- Modify: `apps/web/src/services/renderer/scene-exporter.ts`
- Modify: `apps/web/src/core/managers/renderer-manager.ts`

**Interfaces:**
- Consumes `TimelineAudioStream` from Task 2 and `EXPORT_SAMPLE_RATE`.

- [ ] **Step 1: Change `SceneExporter`**
  - Change `ExportParams.audioBuffer?: AudioBuffer` to `audio?: TimelineAudioStream`.
  - Keep `audioBitrate` and `includeAudio` from `EncodeParams`.
  - **In `encodeVideo`, when `includeAudio && this.audio`:**
    - Probe AAC with `sampleRate: this.audio.sampleRate`, `numberOfChannels: this.audio.numberOfChannels` and `bitrate: audioBitrate`. Keep the existing Opus fallback.
    - Create the `AudioBufferSource`.
    - Define this local helper:
      ```ts
      const pushAudioUntil = async (seconds: number) => {
      	if (!audioSource || !this.audio) return;
      	while (!this.audio.done && this.audio.renderedSamples / this.audio.sampleRate < seconds) {
      		const chunk = await this.guard({ promise: this.audio.nextChunk(), stallMessage: audioStallMessage, frame });
      		if (!chunk) break;
      		await this.guard({ promise: audioSource.add(chunk), stallMessage: audioStallMessage, frame });
      	}
      };
      ```
      Adapt the `guard` call to its current signature: read it, because the earlier fixes changed its parameters. Use the message `"The audio stopped responding while exporting. Try exporting again."`.
    - After `await output.start()`, remove the old one-shot `audioSource.add(this.audioBuffer)`.
    - In the frame loop, call `await pushAudioUntil(timeSeconds + this.audio.chunkSeconds)` before rendering each frame.
    - After the loop, call `await pushAudioUntil(Number.POSITIVE_INFINITY)`, then `audioSource.close()` before finalize.
  - **In `export()`'s pre-start retry path:** call `this.audio?.reset()` before retrying, so the retry starts its audio at 0.

- [ ] **Step 2: Change `renderer-manager.ts` `exportProject`**
  - Replace the `createTimelineAudioBuffer` block, which includes the `onProgress({ progress: 0.05 })` line, with:
    ```ts
    			const audio = encode.includeAudio
    				? await TimelineAudioStream.create({ tracks, mediaAssets, duration, sampleRate: EXPORT_SAMPLE_RATE })
    				: null;
    ```
  - Pass `audio: audio ?? undefined` to `SceneExporter`.
  - Call `audio?.dispose()` in the method's `finally`. If no suitable `finally` exists, add a `try/finally` around the exporter part.
  - Progress becomes the exporter's progress directly: `onProgress?.({ progress })`, with no 0.05 offset.
  - Remove the `createTimelineAudioBuffer` import if it is now unused.

- [ ] **Step 3: Verify**

- Run tsc → `0`.
- Run root `bun test` → no new failures.
- Run `build:web` → succeeds.

- [ ] **Step 4: Commit** (no Co-Authored-By)

`fix(export): stream audio during export instead of decoding whole sources up front`

---

## Task 4: Real-export verification (controller)

- [ ] Build the release and profiling exes.
- [ ] Export the user's "New project" (2 h, 120 fps) at 720p, sampling progress and WebView memory every 10 s for 3 minutes. Expect:
  - no hang at 5%;
  - progress moving from the first sample;
  - the largest WebView2 process staying far below the old 7.5 GB peak.

  Then cancel, and confirm the export state becomes not-exporting within about 3 s.
- [ ] Run 8 back-to-back exports of the test project **with audio**. Expect no stalls.
- [ ] Check every output with ffprobe:
  - an AAC stream exists;
  - the audio duration is within 0.1 s of the video duration;
  - the audio is not silent: `ffmpeg -i f -af volumedetect -f null -` reports `mean_volume` above -60 dB.
- [ ] Run transcription audio extraction once (`extractTimelineAudio`) on the test project and check it returns a WAV of the right length.
- [ ] User review.
