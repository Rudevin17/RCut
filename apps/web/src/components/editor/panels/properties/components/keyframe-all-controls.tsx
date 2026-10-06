"use client";

import { getKeyframeAtTime, resolveAnimationPathValueAtTime } from "@/animation";
import { Button } from "@/components/ui/button";
import { useEditor } from "@/editor/use-editor";
import {
	KEYFRAME_ALL_PATHS,
	findAdjacentKeyframeTime,
	getKeyframeAllState,
} from "@/motion/keyframe-tools";
import { getElementParams, readElementParamValue } from "@/params/registry";
import type { TimelineElement } from "@/timeline";
import { addMediaTime, mediaTime, type MediaTime } from "@/wasm";
import { cn } from "@/utils/ui";
import { HugeiconsIcon } from "@hugeicons/react";
import {
	ArrowLeft01Icon,
	ArrowRight01Icon,
	KeyframeIcon,
} from "@hugeicons/core-free-icons";

export function KeyframeAllControls({
	element,
	trackId,
	localTime,
	isPlayheadWithinElementRange,
}: {
	element: TimelineElement;
	trackId: string;
	localTime: MediaTime;
	isPlayheadWithinElementRange: boolean;
}) {
	const editor = useEditor();
	const state = getKeyframeAllState({
		animations: element.animations,
		localTime,
	});
	const previousTime = findAdjacentKeyframeTime({
		animations: element.animations,
		localTime,
		direction: "previous",
	});
	const nextTime = findAdjacentKeyframeTime({
		animations: element.animations,
		localTime,
		direction: "next",
	});

	const seekToLocalTime = (time: number) => {
		editor.playback.seek({
			time: addMediaTime({ a: element.startTime, b: mediaTime({ ticks: time }) }),
		});
	};

	const toggleAll = () => {
		if (!isPlayheadWithinElementRange) return;

		if (state === "all") {
			editor.timeline.removeKeyframes({
				keyframes: KEYFRAME_ALL_PATHS.flatMap((propertyPath) => {
					const keyframe = getKeyframeAtTime({
						animations: element.animations,
						propertyPath,
						time: localTime,
					});
					return keyframe
						? [
								{
									trackId,
									elementId: element.id,
									propertyPath,
									keyframeId: keyframe.id,
								},
							]
						: [];
				}),
			});
			return;
		}

		const params = getElementParams({ element });
		const keyframes = KEYFRAME_ALL_PATHS.flatMap((propertyPath) => {
			const param = params.find((candidate) => candidate.key === propertyPath);
			if (!param) return [];
			const hasKeyAtTime =
				getKeyframeAtTime({
					animations: element.animations,
					propertyPath,
					time: localTime,
				}) !== null;
			if (hasKeyAtTime) return [];
			const baseValue = readElementParamValue({ element, param });
			if (baseValue === null) return [];
			return [
				{
					trackId,
					elementId: element.id,
					propertyPath,
					time: localTime,
					value: resolveAnimationPathValueAtTime({
						animations: element.animations,
						propertyPath,
						localTime,
						fallbackValue: baseValue,
					}),
				},
			];
		});
		if (keyframes.length === 0) return;
		editor.timeline.upsertKeyframes({ keyframes });
	};

	return (
		<div className="flex items-center justify-end gap-1">
			<Button
				variant="text"
				title="Previous keyframe ([)"
				aria-label="Previous keyframe"
				disabled={previousTime === null}
				onClick={() => previousTime !== null && seekToLocalTime(previousTime)}
				className="[&>svg]:size-3.5"
			>
				<HugeiconsIcon icon={ArrowLeft01Icon} />
			</Button>
			<Button
				variant="text"
				title={
					state === "all"
						? "Remove all keyframes at playhead"
						: "Keyframe all properties at playhead"
				}
				aria-label="Keyframe all properties"
				aria-pressed={state === "all"}
				disabled={!isPlayheadWithinElementRange}
				onClick={toggleAll}
				className="[&>svg]:size-3.5"
			>
				<HugeiconsIcon
					icon={KeyframeIcon}
					className={cn(
						state === "all" && "text-primary fill-primary",
						state === "some" && "text-primary fill-primary/50",
					)}
				/>
			</Button>
			<Button
				variant="text"
				title="Next keyframe (])"
				aria-label="Next keyframe"
				disabled={nextTime === null}
				onClick={() => nextTime !== null && seekToLocalTime(nextTime)}
				className="[&>svg]:size-3.5"
			>
				<HugeiconsIcon icon={ArrowRight01Icon} />
			</Button>
		</div>
	);
}
