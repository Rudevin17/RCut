import { ALL_FORMATS, AudioBufferSink, BlobSource, Input } from "mediabunny";
import type { PcmBlock } from "@/media/audio-export/mixer";

const READ_MARGIN_SECONDS = 0.05;
const MAX_CHANNELS = 2;

/** Keeps one source file open and decodes only the audio ranges asked for. */
export class AudioSourceReader {
	private readonly input: Input;
	private readonly sink: AudioBufferSink;

	private constructor({ input, sink }: { input: Input; sink: AudioBufferSink }) {
		this.input = input;
		this.sink = sink;
	}

	static async open({ file }: { file: Blob }): Promise<AudioSourceReader | null> {
		const input = new Input({ source: new BlobSource(file), formats: ALL_FORMATS });
		const track = await input.getPrimaryAudioTrack();
		if (!track) {
			input.dispose();
			return null;
		}
		return new AudioSourceReader({ input, sink: new AudioBufferSink(track) });
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
