"use client";

import { useEffect, useRef, useState } from "react";
import { useEditor } from "@/editor/use-editor";
import { useElementPreview } from "@/timeline/hooks/use-element-preview";
import type { VisualElement } from "@/timeline";
import type { NumberParamDefinition } from "@/params";
import { Button } from "@/components/ui/button";
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group";
import {
	Section,
	SectionContent,
	SectionFields,
	SectionHeader,
	SectionTitle,
} from "@/components/section";
import { PropertyParamField } from "@/components/editor/panels/properties/components/property-param-field";
import {
	COMBO_PRESETS,
	DEFAULT_COMBO_SPEED,
	DEFAULT_IN_OUT_DURATION,
	IN_PRESETS,
	OUT_PRESETS,
	resolveMotionPhases,
	type ElementMotion,
} from "@/motion";
import {
	mediaTimeFromSeconds,
	mediaTimeToSeconds,
	TICKS_PER_SECOND,
	type MediaTime,
} from "@/wasm";
import { cn } from "@/utils/ui";

type Slot = "in" | "out" | "combo";

const PRESETS_BY_SLOT: Record<Slot, ReadonlyArray<{ id: string; name: string }>> =
	{
		in: IN_PRESETS,
		out: OUT_PRESETS,
		combo: COMBO_PRESETS,
	};

const SLIDER_BY_SLOT: Record<Slot, NumberParamDefinition> = {
	in: {
		key: "motion.in.duration",
		label: "Duration",
		type: "number",
		default: DEFAULT_IN_OUT_DURATION,
		min: 0.1,
		max: 3,
		step: 0.05,
		slider: true,
	},
	out: {
		key: "motion.out.duration",
		label: "Duration",
		type: "number",
		default: DEFAULT_IN_OUT_DURATION,
		min: 0.1,
		max: 3,
		step: 0.05,
		slider: true,
	},
	combo: {
		key: "motion.combo.speed",
		label: "Speed",
		type: "number",
		default: DEFAULT_COMBO_SPEED,
		min: 0.25,
		max: 4,
		step: 0.05,
		slider: true,
	},
};

const PLAYBACK_MARGIN_SECONDS = 0.3;
const COMBO_PREVIEW_SECONDS = 2;

function getSlotValue({
	motion,
	slot,
}: {
	motion: ElementMotion | undefined;
	slot: Slot;
}): { preset: string; amount: number } | null {
	if (slot === "combo") {
		return motion?.combo
			? { preset: motion.combo.preset, amount: motion.combo.speed }
			: null;
	}
	const entry = motion?.[slot];
	return entry ? { preset: entry.preset, amount: entry.duration } : null;
}

/** Returns `motion` with `slot` set to `value`, or cleared when `value` is null. */
function setSlot({
	motion,
	slot,
	value,
}: {
	motion: ElementMotion | undefined;
	slot: Slot;
	value: { preset: string; amount: number } | null;
}): ElementMotion | undefined {
	const next: ElementMotion = { ...motion };
	if (!value) {
		delete next[slot];
	} else if (slot === "combo") {
		next.combo = {
			preset: value.preset as NonNullable<ElementMotion["combo"]>["preset"],
			speed: value.amount,
		};
	} else if (slot === "in") {
		next.in = {
			preset: value.preset as NonNullable<ElementMotion["in"]>["preset"],
			duration: value.amount,
		};
	} else {
		next.out = {
			preset: value.preset as NonNullable<ElementMotion["out"]>["preset"],
			duration: value.amount,
		};
	}
	return next.in || next.out || next.combo ? next : undefined;
}

export function AnimationTab({
	element,
	trackId,
}: {
	element: VisualElement;
	trackId: string;
}) {
	const editor = useEditor();
	const { renderElement, previewUpdates, commit } = useElementPreview({
		trackId,
		elementId: element.id,
		fallback: element,
	});
	const [slot, setSlot_] = useState<Slot>("in");
	const motion = renderElement.motion;
	const current = getSlotValue({ motion, slot });
	const sliderParam = SLIDER_BY_SLOT[slot];

	const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
	const savedTimeRef = useRef<MediaTime | null>(null);

	const stopPlayback = () => {
		if (timerRef.current === null) return;
		clearTimeout(timerRef.current);
		timerRef.current = null;
		editor.playback.pause();
		if (savedTimeRef.current !== null) {
			editor.playback.seek({ time: savedTimeRef.current });
			savedTimeRef.current = null;
		}
	};

	// biome-ignore lint/correctness/useExhaustiveDependencies: cleanup must only run on unmount
	useEffect(() => stopPlayback, []);

	const playPreview = ({
		slot: pickedSlot,
		motion: nextMotion,
	}: {
		slot: Slot;
		motion: ElementMotion;
	}) => {
		const originalTime = savedTimeRef.current ?? editor.playback.getCurrentTime();
		stopPlayback();
		savedTimeRef.current = originalTime;

		const clipSeconds = element.duration / TICKS_PER_SECOND;
		const { inDur, outDur } = resolveMotionPhases({
			motion: nextMotion,
			duration: clipSeconds,
		});
		const startSeconds = mediaTimeToSeconds({ time: element.startTime });
		const endSeconds = startSeconds + clipSeconds;
		let seekSeconds: number;
		let waitSeconds: number;
		if (pickedSlot === "in") {
			seekSeconds = startSeconds;
			waitSeconds = inDur + PLAYBACK_MARGIN_SECONDS;
		} else if (pickedSlot === "out") {
			seekSeconds = Math.max(
				startSeconds,
				endSeconds - outDur - PLAYBACK_MARGIN_SECONDS,
			);
			waitSeconds = endSeconds - seekSeconds;
		} else {
			const playheadSeconds = mediaTimeToSeconds({ time: originalTime });
			const isInsideClip =
				playheadSeconds >= startSeconds && playheadSeconds < endSeconds;
			seekSeconds = isInsideClip ? playheadSeconds : startSeconds;
			waitSeconds = COMBO_PREVIEW_SECONDS;
		}

		editor.playback.seek({
			time: mediaTimeFromSeconds({ seconds: Math.max(0, seekSeconds) }),
		});
		editor.playback.play();
		timerRef.current = setTimeout(() => {
			stopPlayback();
		}, waitSeconds * 1000);
	};

	const pick = ({ presetId }: { presetId: string | null }) => {
		// Re-picking the selected preset only replays it, so it adds no undo step.
		if (presetId === (current?.preset ?? null)) {
			if (presetId && motion) playPreview({ slot, motion });
			return;
		}
		const next = setSlot({
			motion,
			slot,
			value: presetId
				? { preset: presetId, amount: current?.amount ?? sliderParam.default }
				: null,
		});
		previewUpdates({ motion: next });
		commit();
		if (presetId && next) playPreview({ slot, motion: next });
	};

	const onSliderPreview = (value: unknown) => {
		if (!current || typeof value !== "number") return;
		previewUpdates({
			motion: setSlot({
				motion,
				slot,
				value: { preset: current.preset, amount: value },
			}),
		});
	};

	return (
		<Section collapsible sectionKey={`${element.id}:animation`}>
			<SectionHeader>
				<SectionTitle>Animation</SectionTitle>
			</SectionHeader>
			<SectionContent>
				<SectionFields>
					<ToggleGroup
						type="single"
						variant="outline"
						size="sm"
						value={slot}
						onValueChange={(value) => {
							if (value) setSlot_(value as Slot);
						}}
						className="w-full"
					>
						<ToggleGroupItem value="in" className="flex-1">
							In
						</ToggleGroupItem>
						<ToggleGroupItem value="out" className="flex-1">
							Out
						</ToggleGroupItem>
						<ToggleGroupItem value="combo" className="flex-1">
							Combo
						</ToggleGroupItem>
					</ToggleGroup>
					<div className="grid grid-cols-3 gap-2">
						<Button
							variant="outline"
							size="sm"
							className={cn(!current && "bg-accent ring-1 ring-primary")}
							onClick={() => pick({ presetId: null })}
						>
							None
						</Button>
						{PRESETS_BY_SLOT[slot].map((preset) => (
							<Button
								key={preset.id}
								variant="outline"
								size="sm"
								className={cn(
									current?.preset === preset.id && "bg-accent ring-1 ring-primary",
								)}
								onClick={() => pick({ presetId: preset.id })}
							>
								{preset.name}
							</Button>
						))}
					</div>
					{current && (
						<PropertyParamField
							param={sliderParam}
							value={current.amount}
							onPreview={onSliderPreview}
							onCommit={commit}
						/>
					)}
				</SectionFields>
			</SectionContent>
		</Section>
	);
}
