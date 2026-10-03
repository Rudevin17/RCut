import { clampRetimeRate } from "@/retime/rate";
import type { ImageElement, VideoElement, VideoTrack } from "@/timeline";
import type { TrackTransition } from "./types";

export interface TimeRange {
	start: number;
	end: number;
}

export interface PlannedTransition {
	transition: TrackTransition;
	from: VideoElement | ImageElement;
	to: VideoElement | ImageElement;
	/** Timeline window [start, end) centred on the cut. */
	window: TimeRange;
	/** Clip time available past `from`'s end, capped at half the window. */
	fromHandle: number;
	/** Clip time available before `to`'s start, capped at half the window. */
	toHandle: number;
}

export interface TrackTransitionPlan {
	transitions: PlannedTransition[];
	/** Visible range for each element whose ends are covered by a transition. */
	visibleRanges: Map<string, TimeRange>;
}

function getClipRate({ element }: { element: VideoElement | ImageElement }): number {
	return element.type === "video"
		? clampRetimeRate({ rate: element.retime?.rate ?? 1 })
		: 1;
}

function narrowRange({
	ranges,
	element,
	start,
	end,
}: {
	ranges: Map<string, TimeRange>;
	element: VideoElement | ImageElement;
	start?: number;
	end?: number;
}): void {
	const current = ranges.get(element.id) ?? {
		start: element.startTime,
		end: element.startTime + element.duration,
	};
	ranges.set(element.id, {
		start: Math.max(current.start, start ?? current.start),
		end: Math.min(current.end, end ?? current.end),
	});
}

export function planTrackTransitions({
	track,
}: {
	track: VideoTrack;
}): TrackTransitionPlan {
	const elementsById = new Map(
		track.elements.map((element) => [element.id, element]),
	);
	const transitions: PlannedTransition[] = [];
	const visibleRanges = new Map<string, TimeRange>();

	for (const transition of track.transitions ?? []) {
		const from = elementsById.get(transition.fromElementId);
		const to = elementsById.get(transition.toElementId);
		if (!from || !to) continue;

		const cut = from.startTime + from.duration;
		if (cut !== to.startTime) continue;

		const duration = Math.min(transition.duration, from.duration, to.duration);
		if (duration <= 0) continue;

		const half = duration / 2;
		const window = { start: cut - half, end: cut + half };
		transitions.push({
			transition,
			from,
			to,
			window,
			fromHandle: Math.min(half, from.trimEnd / getClipRate({ element: from })),
			toHandle: Math.min(half, to.trimStart / getClipRate({ element: to })),
		});
		narrowRange({ ranges: visibleRanges, element: from, end: window.start });
		narrowRange({ ranges: visibleRanges, element: to, start: window.end });
	}

	return { transitions, visibleRanges };
}

export interface TransitionSideTimes {
	progress: number;
	/** Timeline time for each clip's transform/animations, kept inside the clip. */
	fromVisualTime: number;
	toVisualTime: number;
	/** Clip time used to pick each source frame; extends into handles, then holds. */
	fromSourceClipTime: number;
	toSourceClipTime: number;
}

export function getTransitionSideTimes({
	planned,
	time,
}: {
	planned: PlannedTransition;
	time: number;
}): TransitionSideTimes {
	const { window, from, to, fromHandle, toHandle } = planned;
	const length = window.end - window.start;
	const progress = Math.min(Math.max((time - window.start) / length, 0), 1);
	const fromEnd = from.startTime + from.duration;

	return {
		progress,
		fromVisualTime: Math.min(time, fromEnd - 1),
		toVisualTime: Math.max(time, to.startTime),
		fromSourceClipTime: Math.min(time - from.startTime, from.duration + fromHandle - 1),
		toSourceClipTime: Math.max(time - to.startTime, -toHandle),
	};
}
