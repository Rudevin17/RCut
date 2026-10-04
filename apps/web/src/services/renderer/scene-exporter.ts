import EventEmitter from "eventemitter3";

import {
	Output,
	Mp4OutputFormat,
	WebMOutputFormat,
	BufferTarget,
	CanvasSource,
	AudioBufferSource,
	canEncodeVideo,
	QUALITY_LOW,
	QUALITY_MEDIUM,
	QUALITY_HIGH,
	QUALITY_VERY_HIGH,
	type Quality,
} from "mediabunny";
import { mediaTimeToSeconds } from "opencut-wasm";
import { TICKS_PER_SECOND } from "@/wasm";
import { frameRateToFloat } from "@/fps/utils";
import type { RootNode } from "./nodes/root-node";
import type { ExportQuality } from "@/export";
import { formatFrameRate, type EncodeParams } from "@/export/resolve";
import { CanvasRenderer } from "./canvas-renderer";

type ExportParams = {
	/** The project canvas size. Frames always render at this size. */
	renderWidth: number;
	renderHeight: number;
	encode: EncodeParams;
	audioBuffer?: AudioBuffer;
};

type VideoCodec = "avc" | "vp9";
type HardwareAcceleration = "no-preference" | "prefer-hardware" | "prefer-software";

const qualityMap: Record<ExportQuality, Quality> = {
	low: QUALITY_LOW,
	medium: QUALITY_MEDIUM,
	high: QUALITY_HIGH,
	very_high: QUALITY_VERY_HIGH,
};

export type SceneExporterEvents = {
	progress: [progress: number];
	complete: [buffer: ArrayBuffer];
	error: [error: Error];
	cancelled: [];
};

export class SceneExporter extends EventEmitter<SceneExporterEvents> {
	private renderer: CanvasRenderer;
	private renderWidth: number;
	private renderHeight: number;
	private encode: EncodeParams;
	private audioBuffer?: AudioBuffer;

	private isCancelled = false;

	constructor({ renderWidth, renderHeight, encode, audioBuffer }: ExportParams) {
		super();
		this.renderer = new CanvasRenderer({
			width: renderWidth,
			height: renderHeight,
			fps: encode.fps,
		});
		this.renderWidth = renderWidth;
		this.renderHeight = renderHeight;
		this.encode = encode;
		this.audioBuffer = audioBuffer;
	}

	cancel(): void {
		this.isCancelled = true;
	}

	async export({
		rootNode,
	}: {
		rootNode: RootNode;
	}): Promise<ArrayBuffer | null> {
		const { format, fps, bitrateMode, includeAudio, audioBitrate } = this.encode;
		const fpsFloat = frameRateToFloat(fps);
		const ticksPerFrame = Math.round(
			(TICKS_PER_SECOND * fps.denominator) / fps.numerator,
		);
		const frameCount = Math.floor(rootNode.duration / ticksPerFrame);

		const codec: VideoCodec = format === "webm" ? "vp9" : "avc";
		const videoBitrate =
			typeof this.encode.videoBitrate === "number"
				? this.encode.videoBitrate
				: qualityMap[this.encode.videoBitrate];
		const hardwareAcceleration = await this.pickHardwareAcceleration({
			codec,
			bitrate: videoBitrate,
		});
		const encodeCanvas = this.createEncodeCanvas();

		const output = new Output({
			format: format === "webm" ? new WebMOutputFormat() : new Mp4OutputFormat(),
			target: new BufferTarget(),
		});

		const videoSource = new CanvasSource(encodeCanvas.canvas, {
			codec,
			bitrate: videoBitrate,
			bitrateMode,
			hardwareAcceleration,
		});

		output.addVideoTrack(videoSource, { frameRate: fpsFloat });

		let audioSource: AudioBufferSource | null = null;
		if (includeAudio && this.audioBuffer) {
			let audioCodec: "aac" | "opus" = format === "webm" ? "opus" : "aac";

			if (audioCodec === "aac" && typeof AudioEncoder !== "undefined") {
				const { supported } = await AudioEncoder.isConfigSupported({
					codec: "mp4a.40.2",
					sampleRate: this.audioBuffer.sampleRate,
					numberOfChannels: this.audioBuffer.numberOfChannels,
					bitrate: audioBitrate,
				});
				if (!supported) audioCodec = "opus";
			}

			audioSource = new AudioBufferSource({
				codec: audioCodec,
				bitrate: audioBitrate,
			});
			output.addAudioTrack(audioSource);
		}

		await output.start();

		if (audioSource && this.audioBuffer) {
			await audioSource.add(this.audioBuffer);
			audioSource.close();
		}

		for (let i = 0; i < frameCount; i++) {
			if (this.isCancelled) {
				await output.cancel();
				this.emit("cancelled");
				return null;
			}

			const timeTicks = i * ticksPerFrame;
			const timeSeconds = mediaTimeToSeconds({ time: timeTicks });
			await this.renderer.render({ node: rootNode, time: timeTicks });
			encodeCanvas.draw();
			await videoSource.add(timeSeconds, 1 / fpsFloat);

			this.emit("progress", i / frameCount);
		}

		if (this.isCancelled) {
			await output.cancel();
			this.emit("cancelled");
			return null;
		}

		videoSource.close();
		await output.finalize();
		this.emit("progress", 1);

		const buffer = output.target.buffer;
		if (!buffer) {
			this.emit("error", new Error("Failed to export video"));
			return null;
		}

		this.emit("complete", buffer);
		return buffer;
	}

	/** Prefers the requested acceleration, falls back to the browser's choice, and fails clearly if neither can encode. */
	private async pickHardwareAcceleration({
		codec,
		bitrate,
	}: {
		codec: VideoCodec;
		bitrate: number | Quality;
	}): Promise<HardwareAcceleration> {
		const { width, height, bitrateMode, fps } = this.encode;
		const candidates: HardwareAcceleration[] = [
			this.encode.hardwareAcceleration,
			"no-preference",
		];
		for (const hardwareAcceleration of candidates) {
			const supported = await canEncodeVideo(codec, {
				width,
				height,
				bitrate,
				bitrateMode,
				hardwareAcceleration,
			});
			if (supported) return hardwareAcceleration;
		}
		const codecLabel = codec === "vp9" ? "VP9" : "H.264";
		throw new Error(
			`This computer can't encode ${width}×${height} at ${formatFrameRate(fps)} fps as ${codecLabel}. Try a lower resolution or frame rate.`,
		);
	}

	/** The canvas the encoder reads: the render output itself, or a scaled copy when the export size differs. */
	private createEncodeCanvas(): {
		canvas: HTMLCanvasElement | OffscreenCanvas;
		draw: () => void;
	} {
		const source = this.renderer.getOutputCanvas();
		const { width, height } = this.encode;
		if (width === this.renderWidth && height === this.renderHeight) {
			return { canvas: source, draw: () => {} };
		}

		const canvas = new OffscreenCanvas(width, height);
		const context = canvas.getContext("2d");
		if (!context) {
			throw new Error("Couldn't create the canvas used to scale the export");
		}
		context.imageSmoothingEnabled = true;
		context.imageSmoothingQuality = "high";
		return {
			canvas,
			draw: () => context.drawImage(source, 0, 0, width, height),
		};
	}
}
