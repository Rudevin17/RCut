import {
	getTransitionDefinition,
	getTransitionShaderParams,
} from "@/transitions/registry";
import { createCanvasSurface } from "./canvas-utils";
import { gpuRenderer } from "./gpu-renderer";

const PREVIEW_WIDTH = 160;
const PREVIEW_HEIGHT = 90;
const PREVIEW_IMAGE_PATH = "/effects/preview.jpg";

class TransitionPreviewService {
	private image: HTMLImageElement | null = null;
	private sources: { from: OffscreenCanvas; to: OffscreenCanvas } | null = null;
	private readyCallbacks = new Set<() => void>();

	readonly PREVIEW_WIDTH = PREVIEW_WIDTH;
	readonly PREVIEW_HEIGHT = PREVIEW_HEIGHT;

	constructor() {
		this.loadImage();
	}

	onPreviewImageReady({ callback }: { callback: () => void }): () => void {
		this.readyCallbacks.add(callback);
		return () => this.readyCallbacks.delete(callback);
	}

	renderPreview({
		type,
		progress,
		targetCanvas,
	}: {
		type: string;
		progress: number;
		targetCanvas: HTMLCanvasElement;
	}): void {
		const context = targetCanvas.getContext("2d");
		if (!context) return;
		targetCanvas.width = PREVIEW_WIDTH;
		targetCanvas.height = PREVIEW_HEIGHT;

		const sources = this.getSources();
		const definition = getTransitionDefinition({ type });
		if (!sources || !definition) {
			context.clearRect(0, 0, PREVIEW_WIDTH, PREVIEW_HEIGHT);
			return;
		}

		try {
			const result = gpuRenderer.applyTransition({
				from: sources.from,
				to: sources.to,
				width: PREVIEW_WIDTH,
				height: PREVIEW_HEIGHT,
				shader: definition.shader,
				progress,
				params: getTransitionShaderParams({ definition, params: {} }),
			});
			context.drawImage(result ?? (progress < 0.5 ? sources.from : sources.to), 0, 0);
		} catch (error) {
			console.warn("Failed to render transition preview", { type, error });
			context.drawImage(sources.from, 0, 0);
		}
	}

	private loadImage(): void {
		if (typeof window === "undefined") return;
		const image = new Image();
		image.onload = () => {
			this.sources = null;
			for (const callback of this.readyCallbacks) callback();
		};
		image.src = PREVIEW_IMAGE_PATH;
		this.image = image;
	}

	private getSources(): { from: OffscreenCanvas; to: OffscreenCanvas } | null {
		if (this.sources) return this.sources;
		if (!this.image?.complete || (this.image.naturalWidth ?? 0) === 0) return null;

		const from = createCanvasSurface({ width: PREVIEW_WIDTH, height: PREVIEW_HEIGHT });
		from.context.drawImage(this.image, 0, 0, PREVIEW_WIDTH, PREVIEW_HEIGHT);

		// The incoming side is the same image mirrored and colour-shifted so the
		// transition between them is visible.
		const to = createCanvasSurface({ width: PREVIEW_WIDTH, height: PREVIEW_HEIGHT });
		to.context.filter = "hue-rotate(150deg) saturate(1.4)";
		to.context.translate(PREVIEW_WIDTH, 0);
		to.context.scale(-1, 1);
		to.context.drawImage(this.image, 0, 0, PREVIEW_WIDTH, PREVIEW_HEIGHT);

		this.sources = { from: from.canvas, to: to.canvas };
		return this.sources;
	}
}

export const transitionPreviewService = new TransitionPreviewService();
