import { describe, expect, test } from "bun:test";
import type { VideoElement, VideoTrack } from "@/timeline";
import type { MediaTime } from "@/wasm";
import {
	getTransitionPrewarmTimes,
	getTransitionSideTimes,
	planTrackTransitions,
} from "@/transitions/timing";
import type { TrackTransition } from "@/transitions/types";

const t = (value: number) => value as MediaTime;

function clip({
	id,
	start,
	duration,
	trimStart = 0,
	trimEnd = 0,
}: {
	id: string;
	start: number;
	duration: number;
	trimStart?: number;
	trimEnd?: number;
}): VideoElement {
	return {
		id,
		name: id,
		type: "video",
		mediaId: `media-${id}`,
		startTime: t(start),
		duration: t(duration),
		trimStart: t(trimStart),
		trimEnd: t(trimEnd),
		params: {},
	} as VideoElement;
}

function track({
	elements,
	transitions,
}: {
	elements: VideoElement[];
	transitions: TrackTransition[];
}): VideoTrack {
	return {
		id: "main",
		name: "Main",
		type: "video",
		elements,
		muted: false,
		hidden: false,
		transitions,
	};
}

const crossfade = ({
	duration,
	from = "a",
	to = "b",
}: {
	duration: number;
	from?: string;
	to?: string;
}): TrackTransition => ({
	id: `tr-${from}-${to}`,
	type: "crossfade",
	fromElementId: from,
	toElementId: to,
	duration: t(duration),
	params: {},
});

describe("planTrackTransitions", () => {
	test("centres the window on the cut and limits visible ranges", () => {
		const plan = planTrackTransitions({
			track: track({
				elements: [
					clip({ id: "a", start: 0, duration: 100, trimEnd: 50 }),
					clip({ id: "b", start: 100, duration: 100, trimStart: 50 }),
				],
				transitions: [crossfade({ duration: 20 })],
			}),
		});

		expect(plan.transitions).toHaveLength(1);
		expect(plan.transitions[0].window).toEqual({ start: 90, end: 110 });
		expect(plan.transitions[0].fromHandle).toBe(10);
		expect(plan.transitions[0].toHandle).toBe(10);
		expect(plan.visibleRanges.get("a")).toEqual({ start: 0, end: 90 });
		expect(plan.visibleRanges.get("b")).toEqual({ start: 110, end: 200 });
	});

	test("caps handles at the footage available beyond each clip", () => {
		const plan = planTrackTransitions({
			track: track({
				elements: [
					clip({ id: "a", start: 0, duration: 100, trimEnd: 4 }),
					clip({ id: "b", start: 100, duration: 100 }),
				],
				transitions: [crossfade({ duration: 20 })],
			}),
		});

		expect(plan.transitions[0].fromHandle).toBe(4);
		expect(plan.transitions[0].toHandle).toBe(0);
	});

	test("clamps the duration to the shorter clip", () => {
		const plan = planTrackTransitions({
			track: track({
				elements: [
					clip({ id: "a", start: 0, duration: 10 }),
					clip({ id: "b", start: 10, duration: 100 }),
				],
				transitions: [crossfade({ duration: 50 })],
			}),
		});

		expect(plan.transitions[0].window).toEqual({ start: 5, end: 15 });
	});

	test("skips transitions whose clips are missing or not adjacent", () => {
		const plan = planTrackTransitions({
			track: track({
				elements: [
					clip({ id: "a", start: 0, duration: 100 }),
					clip({ id: "b", start: 120, duration: 100 }),
				],
				transitions: [
					crossfade({ duration: 20 }),
					crossfade({ duration: 20, from: "a", to: "missing" }),
				],
			}),
		});

		expect(plan.transitions).toHaveLength(0);
		expect(plan.visibleRanges.size).toBe(0);
	});

	test("skips transitions touching hidden clips", () => {
		const plan = planTrackTransitions({
			track: track({
				elements: [
					clip({ id: "a", start: 0, duration: 100 }),
					{ ...clip({ id: "b", start: 100, duration: 100 }), hidden: true },
				],
				transitions: [crossfade({ duration: 20 })],
			}),
		});

		expect(plan.transitions).toHaveLength(0);
		expect(plan.visibleRanges.size).toBe(0);
	});

	test("narrows a clip that has transitions on both ends", () => {
		const plan = planTrackTransitions({
			track: track({
				elements: [
					clip({ id: "a", start: 0, duration: 100 }),
					clip({ id: "b", start: 100, duration: 100 }),
					clip({ id: "c", start: 200, duration: 100 }),
				],
				transitions: [
					crossfade({ duration: 20 }),
					crossfade({ duration: 40, from: "b", to: "c" }),
				],
			}),
		});

		expect(plan.visibleRanges.get("b")).toEqual({ start: 110, end: 180 });
	});

	test("returns an empty plan for tracks without transitions", () => {
		const plan = planTrackTransitions({
			track: { ...track({ elements: [], transitions: [] }), transitions: undefined },
		});
		expect(plan.transitions).toEqual([]);
	});
});

describe("getTransitionSideTimes", () => {
	const [planned] = planTrackTransitions({
		track: track({
			elements: [
				clip({ id: "a", start: 0, duration: 100, trimEnd: 4 }),
				clip({ id: "b", start: 100, duration: 100, trimStart: 50 }),
			],
			transitions: [crossfade({ duration: 20 })],
		}),
	}).transitions;

	test("progress runs from 0 to 1 across the window", () => {
		expect(getTransitionSideTimes({ planned, time: 90 }).progress).toBe(0);
		expect(getTransitionSideTimes({ planned, time: 100 }).progress).toBe(0.5);
		expect(getTransitionSideTimes({ planned, time: 110 }).progress).toBe(1);
	});

	test("keeps visual times inside each clip", () => {
		const times = getTransitionSideTimes({ planned, time: 95 });
		expect(times.fromVisualTime).toBe(95);
		expect(times.toVisualTime).toBe(100);

		const later = getTransitionSideTimes({ planned, time: 105 });
		expect(later.fromVisualTime).toBe(99);
		expect(later.toVisualTime).toBe(105);
	});

	test("source times extend into handles and then hold the edge frame", () => {
		const times = getTransitionSideTimes({ planned, time: 108 });
		// `a` has 4 ticks of handle: clip time 108 is held at 100 + 4 - 1.
		expect(times.fromSourceClipTime).toBe(103);
		expect(times.toSourceClipTime).toBe(8);

		const early = getTransitionSideTimes({ planned, time: 92 });
		// `b` has 10 ticks of pre-roll available (capped at half the window).
		expect(early.toSourceClipTime).toBe(-8);
		expect(early.fromSourceClipTime).toBe(92);
	});
});

describe("getTransitionPrewarmTimes", () => {
	const [planned] = planTrackTransitions({
		track: track({
			elements: [
				clip({ id: "a", start: 0, duration: 100, trimEnd: 4 }),
				clip({ id: "b", start: 100, duration: 100, trimStart: 50 }),
			],
			transitions: [crossfade({ duration: 20 })],
		}),
	}).transitions;

	test("is null well before the lead time", () => {
		expect(getTransitionPrewarmTimes({ planned, time: 50, leadTime: 20 })).toBeNull();
	});

	test("returns the incoming start position inside the lead time", () => {
		expect(getTransitionPrewarmTimes({ planned, time: 75, leadTime: 20 })).toEqual({
			toVisualTime: 100,
			toSourceClipTime: -10,
		});
	});

	test("includes the exact lead boundary", () => {
		expect(getTransitionPrewarmTimes({ planned, time: 70, leadTime: 20 })).not.toBeNull();
	});

	test("is null at window start and inside the window", () => {
		expect(getTransitionPrewarmTimes({ planned, time: 90, leadTime: 20 })).toBeNull();
		expect(getTransitionPrewarmTimes({ planned, time: 100, leadTime: 20 })).toBeNull();
	});

	test("matches the incoming side times at window start", () => {
		const prewarm = getTransitionPrewarmTimes({ planned, time: 80, leadTime: 20 });
		const atStart = getTransitionSideTimes({ planned, time: planned.window.start });
		expect(prewarm?.toVisualTime).toBe(atStart.toVisualTime);
		expect(prewarm?.toSourceClipTime).toBe(atStart.toSourceClipTime);
	});
});
