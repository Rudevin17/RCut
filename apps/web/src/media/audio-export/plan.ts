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
