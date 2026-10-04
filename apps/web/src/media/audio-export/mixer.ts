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
