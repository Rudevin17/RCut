import {
	getChannelsFromData,
	isAnimationStorageKey,
} from "@/animation/channel-data";
import type { AnimationPath, ElementAnimations } from "@/animation/types";

export const KEYFRAME_ALL_PATHS = [
	"transform.positionX",
	"transform.positionY",
	"transform.scaleX",
	"transform.scaleY",
	"transform.rotate",
	"opacity",
] as const satisfies readonly AnimationPath[];

// Reads channel keys directly: `@/animation/keyframe-query` pulls in the wasm
// package at runtime, which would make this module untestable under `bun test`.
function getKeyTimes({
	animations,
	propertyPath,
}: {
	animations: ElementAnimations | undefined;
	propertyPath?: AnimationPath;
}): number[] {
	if (!animations) return [];
	const entries = propertyPath
		? [[propertyPath, animations[propertyPath]] as const]
		: Object.entries(animations).filter(([key]) =>
				isAnimationStorageKey({ key }),
			);
	return entries.flatMap(([, data]) =>
		getChannelsFromData({ data }).flatMap((channel) =>
			channel.keys.map((key) => key.time as number),
		),
	);
}

export function getKeyframeAllState({
	animations,
	localTime,
}: {
	animations: ElementAnimations | undefined;
	localTime: number;
}): "all" | "some" | "none" {
	const keyedCount = KEYFRAME_ALL_PATHS.filter((propertyPath) =>
		getKeyTimes({ animations, propertyPath }).includes(localTime),
	).length;
	if (keyedCount === 0) return "none";
	return keyedCount === KEYFRAME_ALL_PATHS.length ? "all" : "some";
}

export function findAdjacentKeyframeTime({
	animations,
	localTime,
	direction,
}: {
	animations: ElementAnimations | undefined;
	localTime: number;
	direction: "previous" | "next";
}): number | null {
	const times = getKeyTimes({ animations });
	const candidates =
		direction === "previous"
			? times.filter((time) => time < localTime)
			: times.filter((time) => time > localTime);
	if (candidates.length === 0) return null;
	return direction === "previous"
		? Math.max(...candidates)
		: Math.min(...candidates);
}
