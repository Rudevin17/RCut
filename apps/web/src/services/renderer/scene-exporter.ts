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

/** WebView2's software encoder sometimes stops responding without any error, so a frame that takes this long fails the export. */
const STALL_TIMEOUT_MS = 20_000;
/** Cancelling the output can hang on a stuck encoder, so it gets this long before we move on. */
const OUTPUT_CANCEL_TIMEOUT_MS = 2_000;

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

/** An encode attempt that failed, with how many video frames it had added and the original error. */
class EncodeError extends Error {
	framesEncoded: number;
	declare cause: unknown;

	constructor({ cause, framesEncoded }: { cause: unknown; framesEncoded: number }) {
		super(cause instanceof Error ? cause.message : String(cause));
		this.cause = cause;
		this.framesEncoded = framesEncoded;
	}
}

/** Thrown inside an encode attempt when the user cancels, so the attempt unwinds immediately. */
class ExportCancelled extends Error {}

export class SceneExporter extends EventEmitter<SceneExporterEvents> {
	private renderer: CanvasRenderer;
	private renderWidth: number;
	private renderHeight: number;
	private encode: EncodeParams;
	private audioBuffer?: AudioBuffer;

	private isCancelled = false;
	private cancelController = new AbortController();

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
		this.cancelController.abort();
	}

	/** Awaits `promise`, but gives up when the user cancels (ExportCancelled) or it takes longer than STALL_TIMEOUT_MS (an Error with `stallMessage`). */
	private async guard<T>({
		promise,
		stallMessage,
	}: {
		promise: Promise<T>;
		stallMessage: string;
	}): Promise<T> {
		// If the race is lost, the abandoned promise may still reject later; that must not surface.
		promise.catch(() => {});
		const { signal } = this.cancelController;
		if (signal.aborted) throw new ExportCancelled();

		let timer: ReturnType<typeof setTimeout> | undefined;
		let onAbort: (() => void) | undefined;
		const interrupted = new Promise<never>((_, reject) => {
			timer = setTimeout(() => reject(new Error(stallMessage)), STALL_TIMEOUT_MS);
			onAbort = () => reject(new ExportCancelled());
			signal.addEventListener("abort", onAbort, { once: true });
		});
		try {
			return await Promise.race([promise, interrupted]);
		} finally {
			clearTimeout(timer);
			if (onAbort) signal.removeEventListener("abort", onAbort);
		}
	}

	/** Cancels the output without waiting forever on a stuck encoder. */
	private async cancelOutput({ output }: { output: Output }): Promise<void> {
		let timer: ReturnType<typeof setTimeout> | undefined;
		const timeout = new Promise<void>((resolve) => {
			timer = setTimeout(resolve, OUTPUT_CANCEL_TIMEOUT_MS);
		});
		try {
			await Promise.race([output.cancel().catch(() => {}), timeout]);
		} finally {
			clearTimeout(timer);
		}
	}

	async export({
		rootNode,
	}: {
		rootNode: RootNode;
	}): Promise<ArrayBuffer | null> {
		const { format } = this.encode;
		const codec: VideoCodec = format === "webm" ? "vp9" : "avc";
		const videoBitrate =
			typeof this.encode.videoBitrate === "number"
				? this.encode.videoBitrate
				: qualityMap[this.encode.videoBitrate];
		const picked = await this.pickHardwareAcceleration({
			codec,
			bitrate: videoBitrate,
		});
		const encodeCanvas = this.createEncodeCanvas();
		const params = { rootNode, encodeCanvas, codec, videoBitrate };

		let buffer: ArrayBuffer | null;
		try {
			buffer = await this.encodeVideo({ ...params, hardwareAcceleration: picked });
		} catch (error) {
			// A cancel that arrives during a failed attempt still ends as a cancel.
			if (this.isCancelled) {
				this.emit("cancelled");
				return null;
			}
			if (!(error instanceof EncodeError)) throw error;
			// The pre-check can't see every rejected config (e.g. framerate), so retry once with the browser's choice.
			const canRetry =
				picked !== "no-preference" &&
				error.framesEncoded === 0 &&
				!this.isCancelled;
			if (!canRetry) throw error.cause;
			try {
				buffer = await this.encodeVideo({
					...params,
					hardwareAcceleration: "no-preference",
				});
			} catch (retryError) {
				if (this.isCancelled) {
					this.emit("cancelled");
					return null;
				}
				throw retryError instanceof EncodeError ? retryError.cause : retryError;
			}
		}

		if (this.isCancelled && !buffer) {
			this.emit("cancelled");
			return null;
		}
		if (!buffer) {
			this.emit("error", new Error("Failed to export video"));
			return null;
		}

		this.emit("complete", buffer);
		return buffer;
	}

	/** One full encode attempt. Returns null when cancelled; throws an EncodeError (after cancelling the output) on failure. */
	private async encodeVideo({
		rootNode,
		hardwareAcceleration,
		encodeCanvas,
		codec,
		videoBitrate,
	}: {
		rootNode: RootNode;
		hardwareAcceleration: HardwareAcceleration;
		encodeCanvas: { canvas: HTMLCanvasElement | OffscreenCanvas; draw: () => void };
		codec: VideoCodec;
		videoBitrate: number | Quality;
	}): Promise<ArrayBuffer | null> {
		const { format, fps, bitrateMode, includeAudio, audioBitrate } = this.encode;
		const fpsFloat = frameRateToFloat(fps);
		const ticksPerFrame = Math.round(
			(TICKS_PER_SECOND * fps.denominator) / fps.numerator,
		);
		const frameCount = Math.floor(rootNode.duration / ticksPerFrame);
		let framesEncoded = 0;

		const output = new Output({
			format: format === "webm" ? new WebMOutputFormat() : new Mp4OutputFormat(),
			target: new BufferTarget(),
		});

		try {
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
					await this.cancelOutput({ output });
					return null;
				}

				const timeTicks = i * ticksPerFrame;
				const timeSeconds = mediaTimeToSeconds({ time: timeTicks });
				const stallMessage = `The video encoder stopped responding while exporting (frame ${i + 1}). Try exporting again, or choose MP4.`;
				await this.guard({
					promise: this.renderer.render({ node: rootNode, time: timeTicks }),
					stallMessage,
				});
				encodeCanvas.draw();
				await this.guard({
					promise: videoSource.add(timeSeconds, 1 / fpsFloat),
					stallMessage,
				});
				framesEncoded++;

				this.emit("progress", i / frameCount);
			}

			if (this.isCancelled) {
				await this.cancelOutput({ output });
				return null;
			}

			// close() is synchronous; finalize() is what awaits the encoder flush, so it can hang like add() does.
			// Once finalize has started, output.cancel() can't release a stuck encoder (a mediabunny limitation).
			await this.guard({
				promise: (async () => {
					videoSource.close();
					await output.finalize();
				})(),
				stallMessage:
					"The video encoder stopped responding while finishing the export. Try exporting again, or choose MP4.",
			});
			this.emit("progress", 1);

			return output.target.buffer;
		} catch (error) {
			await this.cancelOutput({ output });
			if (error instanceof ExportCancelled) return null;
			throw new EncodeError({ cause: error, framesEncoded });
		}
	}

	/** Prefers hardware encoding, falls back to the browser's choice, and fails clearly if neither can encode. */
	private async pickHardwareAcceleration({
		codec,
		bitrate,
	}: {
		codec: VideoCodec;
		bitrate: number | Quality;
	}): Promise<HardwareAcceleration> {
		const { width, height, bitrateMode, fps } = this.encode;
		const candidates: HardwareAcceleration[] = ["prefer-hardware", "no-preference"];
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
