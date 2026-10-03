import type {
	ImageElement,
	SceneTracks,
	TimelineTrack,
	VideoElement,
} from "@/timeline";
import type { MediaAsset } from "@/media/types";
import {
	getTransitionDefinition,
	getTransitionShaderParams,
} from "@/transitions/registry";
import { planTrackTransitions, type TimeRange } from "@/transitions/timing";
import { RootNode } from "./nodes/root-node";
import { VideoNode } from "./nodes/video-node";
import { ImageNode } from "./nodes/image-node";
import { TextNode } from "./nodes/text-node";
import { StickerNode } from "./nodes/sticker-node";
import { GraphicNode } from "./nodes/graphic-node";
import { ColorNode } from "./nodes/color-node";
import { BlurBackgroundNode } from "./nodes/blur-background-node";
import { EffectLayerNode } from "./nodes/effect-layer-node";
import { TransitionNode } from "./nodes/transition-node";
import type { AnyBaseNode } from "./nodes/base-node";
import type { TBackground, TCanvasSize } from "@/project/types";
import { DEFAULT_BACKGROUND_BLUR_INTENSITY } from "@/background/blur";
import {
	buildTransformFromParams,
	readBlendModeFromParams,
	readOpacityFromParams,
} from "@/rendering";

const PREVIEW_MAX_IMAGE_SIZE = 2048;

function getVisibleSortedElements({ track }: { track: TimelineTrack }) {
	return track.elements
		.filter((element) => !("hidden" in element && element.hidden))
		.slice()
		.sort((a, b) => {
			if (a.startTime !== b.startTime) return a.startTime - b.startTime;
			return a.id.localeCompare(b.id);
		});
}

function createMediaElementNode({
	element,
	mediaAsset,
	isPreview,
	visibleRange,
	cacheKey,
}: {
	element: VideoElement | ImageElement;
	mediaAsset: MediaAsset;
	isPreview?: boolean;
	visibleRange?: TimeRange;
	cacheKey?: string;
}): VideoNode | ImageNode | null {
	if (element.type === "video" && mediaAsset.type === "video") {
		return new VideoNode({
			mediaId: mediaAsset.id,
			url: mediaAsset.url ?? "",
			file: mediaAsset.file,
			duration: element.duration,
			timeOffset: element.startTime,
			trimStart: element.trimStart,
			trimEnd: element.trimEnd,
			retime: element.retime,
			transform: buildTransformFromParams({ params: element.params }),
			animations: element.animations,
			opacity: readOpacityFromParams({ params: element.params }),
			blendMode: readBlendModeFromParams({ params: element.params }),
			effects: element.effects ?? [],
			masks: element.masks ?? [],
			visibleRange,
			cacheKey,
		});
	}
	if (element.type === "image" && mediaAsset.type === "image") {
		return new ImageNode({
			url: mediaAsset.url ?? "",
			duration: element.duration,
			timeOffset: element.startTime,
			trimStart: element.trimStart,
			trimEnd: element.trimEnd,
			transform: buildTransformFromParams({ params: element.params }),
			animations: element.animations,
			opacity: readOpacityFromParams({ params: element.params }),
			blendMode: readBlendModeFromParams({ params: element.params }),
			effects: element.effects ?? [],
			masks: element.masks ?? [],
			visibleRange,
			...(isPreview && { maxSourceSize: PREVIEW_MAX_IMAGE_SIZE }),
		});
	}
	return null;
}

function createBlurBackgroundNode({
	element,
	mediaAsset,
	blurIntensity,
	visibleRange,
}: {
	element: VideoElement | ImageElement;
	mediaAsset: MediaAsset;
	blurIntensity: number;
	visibleRange?: TimeRange;
}): BlurBackgroundNode | null {
	if (mediaAsset.type !== "video" && mediaAsset.type !== "image") {
		return null;
	}
	return new BlurBackgroundNode({
		mediaId: mediaAsset.id,
		url: mediaAsset.url ?? "",
		file: mediaAsset.file,
		mediaType: mediaAsset.type,
		duration: element.duration,
		timeOffset: element.startTime,
		trimStart: element.trimStart,
		trimEnd: element.trimEnd,
		retime: element.type === "video" ? element.retime : undefined,
		blurIntensity,
		visibleRange,
	});
}

function buildTrackNodes({
	tracks,
	mediaMap,
	canvasSize,
	isPreview,
	mainTrackId,
	blurIntensity,
}: {
	tracks: TimelineTrack[];
	mediaMap: Map<string, MediaAsset>;
	canvasSize: TCanvasSize;
	isPreview?: boolean;
	mainTrackId?: string;
	blurIntensity: number | null;
}): AnyBaseNode[] {
	const nodes: AnyBaseNode[] = [];

	for (const track of tracks) {
		const elements = getVisibleSortedElements({ track });
		const plan = track.type === "video" ? planTrackTransitions({ track }) : null;

		for (const element of elements) {
			if (element.type === "effect") {
				nodes.push(
					new EffectLayerNode({
						effectType: element.effectType,
						effectParams: element.params,
						timeOffset: element.startTime,
						duration: element.duration,
					}),
				);
				continue;
			}

			if (element.type === "video" || element.type === "image") {
				const mediaAsset = mediaMap.get(element.mediaId);
				if (!mediaAsset?.file || !mediaAsset?.url) {
					continue;
				}

				const node = createMediaElementNode({
					element,
					mediaAsset,
					isPreview,
					visibleRange: plan?.visibleRanges.get(element.id),
				});
				if (node) {
					nodes.push(node);
				}
			}

			if (element.type === "text") {
				nodes.push(
					new TextNode({
						...element,
						transform: buildTransformFromParams({ params: element.params }),
						opacity: readOpacityFromParams({ params: element.params }),
						blendMode: readBlendModeFromParams({ params: element.params }),
						canvasCenter: { x: canvasSize.width / 2, y: canvasSize.height / 2 },
						canvasHeight: canvasSize.height,
						textBaseline: "middle",
						effects: element.effects ?? [],
					}),
				);
			}

			if (element.type === "sticker") {
				nodes.push(
					new StickerNode({
						stickerId: element.stickerId,
						intrinsicWidth: element.intrinsicWidth,
						intrinsicHeight: element.intrinsicHeight,
						duration: element.duration,
						timeOffset: element.startTime,
						trimStart: element.trimStart,
						trimEnd: element.trimEnd,
						transform: buildTransformFromParams({ params: element.params }),
						animations: element.animations,
						opacity: readOpacityFromParams({ params: element.params }),
						blendMode: readBlendModeFromParams({ params: element.params }),
						effects: element.effects ?? [],
					}),
				);
			}

			if (element.type === "graphic") {
				nodes.push(
					new GraphicNode({
						definitionId: element.definitionId,
						params: element.params,
						duration: element.duration,
						timeOffset: element.startTime,
						trimStart: element.trimStart,
						trimEnd: element.trimEnd,
						transform: buildTransformFromParams({ params: element.params }),
						animations: element.animations,
						opacity: readOpacityFromParams({ params: element.params }),
						blendMode: readBlendModeFromParams({ params: element.params }),
						effects: element.effects ?? [],
						masks: element.masks ?? [],
					}),
				);
			}
		}

		if (plan) {
			nodes.push(
				...buildTransitionNodes({
					plan,
					mediaMap,
					isPreview,
					blurIntensity: track.id === mainTrackId ? blurIntensity : null,
				}),
			);
		}
	}

	return nodes;
}

function buildTransitionNodes({
	plan,
	mediaMap,
	isPreview,
	blurIntensity,
}: {
	plan: ReturnType<typeof planTrackTransitions>;
	mediaMap: Map<string, MediaAsset>;
	isPreview?: boolean;
	blurIntensity: number | null;
}): TransitionNode[] {
	const nodes: TransitionNode[] = [];

	for (const planned of plan.transitions) {
		const definition = getTransitionDefinition({ type: planned.transition.type });
		const fromAsset = mediaMap.get(planned.from.mediaId);
		const toAsset = mediaMap.get(planned.to.mediaId);
		if (!definition || !fromAsset?.file || !toAsset?.file) {
			continue;
		}

		// Clips cut from the same file need separate decode streams for the incoming side.
		const toCacheKey =
			fromAsset.id === toAsset.id ? `${toAsset.id}:transition-incoming` : undefined;
		const fromNode = createMediaElementNode({
			element: planned.from,
			mediaAsset: fromAsset,
			isPreview,
		});
		const toNode = createMediaElementNode({
			element: planned.to,
			mediaAsset: toAsset,
			isPreview,
			cacheKey: toCacheKey,
		});
		if (!fromNode || !toNode) {
			continue;
		}

		const fromBlur =
			blurIntensity === null
				? null
				: createBlurBackgroundNode({
						element: planned.from,
						mediaAsset: fromAsset,
						blurIntensity,
					});
		const toBlur =
			blurIntensity === null
				? null
				: createBlurBackgroundNode({
						element: planned.to,
						mediaAsset: toAsset,
						blurIntensity,
					});

		nodes.push(
			new TransitionNode({
				planned,
				shader: definition.shader,
				shaderParams: getTransitionShaderParams({
					definition,
					params: planned.transition.params,
				}),
				fromNodes: fromBlur ? [fromBlur, fromNode] : [fromNode],
				toNodes: toBlur ? [toBlur, toNode] : [toNode],
			}),
		);
	}

	return nodes;
}

function buildBlurBackgroundNodes({
	track,
	mediaMap,
	blurIntensity,
	visibleRanges,
}: {
	track: TimelineTrack | undefined;
	mediaMap: Map<string, MediaAsset>;
	blurIntensity: number;
	visibleRanges?: Map<string, TimeRange>;
}): AnyBaseNode[] {
	if (!track) {
		return [];
	}

	const nodes: AnyBaseNode[] = [];
	const elements = getVisibleSortedElements({ track });

	for (const element of elements) {
		if (element.type !== "video" && element.type !== "image") {
			continue;
		}

		const mediaAsset = mediaMap.get(element.mediaId);
		if (
			!mediaAsset?.file ||
			!mediaAsset?.url ||
			(mediaAsset.type !== "video" && mediaAsset.type !== "image")
		) {
			continue;
		}

		const node = createBlurBackgroundNode({
			element,
			mediaAsset,
			blurIntensity,
			visibleRange: visibleRanges?.get(element.id),
		});
		if (node) {
			nodes.push(node);
		}
	}

	return nodes;
}

export type BuildSceneParams = {
	canvasSize: TCanvasSize;
	tracks: SceneTracks;
	mediaAssets: MediaAsset[];
	duration: number;
	background: TBackground;
	isPreview?: boolean;
};

export function buildScene({
	canvasSize,
	tracks,
	mediaAssets,
	duration,
	background,
	isPreview,
}: BuildSceneParams) {
	const rootNode = new RootNode({ duration });
	const mediaMap = new Map(mediaAssets.map((m) => [m.id, m]));

	const visibleTracks = [
		...tracks.overlay.filter((track) => !("hidden" in track && track.hidden)),
		...(!tracks.main.hidden ? [tracks.main] : []),
	];
	const orderedTracksBottomToTop = visibleTracks.slice().reverse();
	const mainTrack = tracks.main.hidden ? undefined : tracks.main;

	const blurIntensity =
		background.type === "blur"
			? (background.blurIntensity ?? DEFAULT_BACKGROUND_BLUR_INTENSITY)
			: null;

	const allNodes = buildTrackNodes({
		tracks: orderedTracksBottomToTop,
		mediaMap,
		canvasSize,
		isPreview,
		mainTrackId: mainTrack?.id,
		blurIntensity,
	});

	if (blurIntensity !== null) {
		const blurNodes = buildBlurBackgroundNodes({
			track: mainTrack,
			mediaMap,
			blurIntensity,
			visibleRanges: mainTrack
				? planTrackTransitions({ track: mainTrack }).visibleRanges
				: undefined,
		});
		for (const node of blurNodes) {
			rootNode.add(node);
		}
	} else if (
		background.type === "color" &&
		background.color !== "transparent"
	) {
		rootNode.add(new ColorNode({ color: background.color }));
	}

	for (const node of allNodes) {
		rootNode.add(node);
	}

	return rootNode;
}
