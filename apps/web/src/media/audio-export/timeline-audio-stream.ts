import type { AudioElement, RetimeConfig, SceneTracks, VideoElement } from "@/timeline";
import type { MediaAsset } from "@/media/types";
import { collectAudibleCandidates } from "@/media/audio";
import { mediaSupportsAudio } from "@/media/media-utils";
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
import { getEffectiveRateAt, renderRetimedBuffer } from "@/retime";
import { TICKS_PER_SECOND } from "@/wasm";

const PRE_ROLL_SECONDS = 0.25;
const CHANNELS = 2;

type ClipSource =
	| { kind: "reader"; reader: AudioSourceReader }
	| { kind: "block"; block: PcmBlock };

/** A clip to mix, with its element name for error messages. */
type ClipEntry = { clip: AudioMixClip; source: ClipSource; name: string };

/** Streams the timeline's audio as mixed, mastered windows of CHUNK_SECONDS. */
export class TimelineAudioStream {
	readonly numberOfChannels = CHANNELS;
	readonly chunkSeconds = CHUNK_SECONDS;
	private chunkIndex = 0;
	private preRoll: Float32Array[] = [new Float32Array(0), new Float32Array(0)];

	readonly sampleRate: number;
	readonly totalSamples: number;
	private readonly clips: ClipEntry[];
	private readonly readers: AudioSourceReader[];

	private constructor({
		sampleRate,
		totalSamples,
		clips,
		readers,
	}: {
		sampleRate: number;
		totalSamples: number;
		clips: ClipEntry[];
		readers: AudioSourceReader[];
	}) {
		this.sampleRate = sampleRate;
		this.totalSamples = totalSamples;
		this.clips = clips;
		this.readers = readers;
	}

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
		const clips: ClipEntry[] = [];

		try {
			for (const { element, mediaAsset } of collectAudibleCandidates({ tracks, mediaAssets })) {
				if (isElementMuted({ element })) continue;
				const file = await resolveSourceFile({ element, mediaAsset });
				if (!file) continue;
				const sourceKey = mediaAsset?.id ?? element.id;
				if (!readersByKey.has(sourceKey)) {
					readersByKey.set(sourceKey, await openReader({ file: file.blob, name: element.name }));
				}
				const reader = readersByKey.get(sourceKey);
				if (!reader) continue;

				const rate = getEffectiveRateAt({ retime: element.retime });
				const clip: AudioMixClip = {
					id: element.id,
					sourceKey,
					startTime: element.startTime / TICKS_PER_SECOND,
					duration: element.duration / TICKS_PER_SECOND,
					trimStart: element.trimStart / TICKS_PER_SECOND,
					rate,
					maintainPitch:
						rate !== 1 &&
						shouldMaintainPitch({ rate, maintainPitch: element.retime?.maintainPitch }),
					volume: resolveEffectiveAudioGain({ element, localTime: 0 }),
					gainAt: hasAnimatedVolume({ element })
						? (clipTime) => resolveEffectiveAudioGain({ element, localTime: clipTime })
						: undefined,
				};

				if (clip.maintainPitch) {
					const block = await prerenderPitchedClip({ clip, reader, sampleRate, retime: element.retime });
					if (block) {
						clips.push({
							clip: { ...clip, trimStart: 0, rate: 1 },
							source: { kind: "block", block },
							name: element.name,
						});
					}
					continue;
				}
				clips.push({ clip, source: { kind: "reader", reader }, name: element.name });
			}
		} catch (error) {
			for (const reader of readersByKey.values()) reader?.dispose();
			throw error;
		}

		const readers = [...readersByKey.values()].filter((reader): reader is AudioSourceReader => !!reader);
		if (clips.length === 0) {
			for (const reader of readers) reader.dispose();
			return null;
		}
		const totalSamples = Math.ceil((duration / TICKS_PER_SECOND) * sampleRate);
		return new TimelineAudioStream({ sampleRate, totalSamples, clips, readers });
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
		for (const { clip, source, name } of this.clips) {
			const range = getClipSourceRange({ clip, window, sampleRate: this.sampleRate });
			if (!range) continue;
			let block: PcmBlock | null;
			if (source.kind === "block") {
				block = source.block;
			} else {
				try {
					block = await source.reader.read({ start: range.sourceStart, end: range.sourceEnd });
				} catch (cause) {
					const time = formatTimelineTime({ seconds: window.startSample / this.sampleRate });
					throw new Error(`Couldn't decode the audio of "${name}" around ${time}.`, { cause });
				}
			}
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

/** The file holding an element's audio: the media asset's file, or the fetched library track. */
async function resolveSourceFile({
	element,
	mediaAsset,
}: {
	element: AudioElement | VideoElement;
	mediaAsset: MediaAsset | null;
}): Promise<{ blob: Blob } | null> {
	if (element.type === "audio" && element.sourceType !== "upload") {
		try {
			const response = await fetch(element.sourceUrl);
			if (!response.ok) {
				throw new Error(`Library audio fetch failed: ${response.status}`);
			}
			return { blob: await response.blob() };
		} catch (error) {
			console.warn("Failed to fetch library audio:", error);
			return null;
		}
	}
	if (!mediaAsset || !mediaSupportsAudio({ media: mediaAsset })) return null;
	return { blob: mediaAsset.file };
}

/** Opens a source reader (null when the file has no audio track); throws a named error when it can't be read. */
async function openReader({
	file,
	name,
}: {
	file: Blob;
	name: string;
}): Promise<AudioSourceReader | null> {
	try {
		return await AudioSourceReader.open({ file });
	} catch (cause) {
		throw new Error(
			`Couldn't read the audio of "${name}". The file may be missing or unsupported.`,
			{ cause },
		);
	}
}

/** Formats seconds as m:ss. */
function formatTimelineTime({ seconds }: { seconds: number }): string {
	const wholeSeconds = Math.floor(seconds);
	const minutes = Math.floor(wholeSeconds / 60);
	return `${minutes}:${String(wholeSeconds % 60).padStart(2, "0")}`;
}

/** Renders a pitch-preserving retimed clip once, as a block mixed at rate 1 from clip time 0. */
async function prerenderPitchedClip({
	clip,
	reader,
	sampleRate,
	retime,
}: {
	clip: AudioMixClip;
	reader: AudioSourceReader;
	sampleRate: number;
	retime?: RetimeConfig;
}): Promise<PcmBlock | null> {
	const block = await reader.read({
		start: clip.trimStart,
		end: clip.trimStart + clip.duration * clip.rate,
	});
	if (!block || block.channels.length === 0 || block.channels[0].length === 0) return null;

	const sourceBuffer = new AudioBuffer({
		numberOfChannels: block.channels.length,
		length: block.channels[0].length,
		sampleRate: block.sampleRate,
	});
	block.channels.forEach((channel, index) => sourceBuffer.getChannelData(index).set(channel));

	const rendered = await renderRetimedBuffer({
		audioContext: new OfflineAudioContext(CHANNELS, 1, sampleRate),
		sourceBuffer,
		trimStart: clip.trimStart - block.startTime,
		clipDuration: clip.duration,
		retime,
		maintainPitch: true,
	});
	return {
		channels: Array.from({ length: rendered.numberOfChannels }, (_, channel) =>
			rendered.getChannelData(channel),
		),
		sampleRate: rendered.sampleRate,
		startTime: 0,
	};
}
