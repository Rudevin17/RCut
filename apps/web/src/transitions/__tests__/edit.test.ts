import { describe, expect, test } from "bun:test";
import type { SceneTracks, VideoElement, VideoTrack } from "@/timeline";
import type { MediaTime } from "@/wasm";
import {
	findCutNearTime,
	findCuts,
	getElementCut,
	getVideoTrackById,
	moveTransitionsToSplitRightHalves,
	reconcileTransitions,
	removeTransition,
	restoreTransitionsAfterRipple,
	setTransitionOnCut,
	updateTransition,
} from "@/transitions/edit";
import type { TrackTransition } from "@/transitions/types";

const t = (value: number) => value as MediaTime;

function clip({
	id,
	start,
	duration,
	hidden,
}: {
	id: string;
	start: number;
	duration: number;
	hidden?: boolean;
}): VideoElement {
	return {
		id,
		name: id,
		type: "video",
		mediaId: "m",
		startTime: t(start),
		duration: t(duration),
		trimStart: t(0),
		trimEnd: t(0),
		params: {},
		...(hidden ? { hidden: true } : {}),
	} as VideoElement;
}

function videoTrack({
	id = "main",
	elements,
	transitions = [],
}: {
	id?: string;
	elements: VideoElement[];
	transitions?: TrackTransition[];
}): VideoTrack {
	return { id, name: id, type: "video", elements, muted: false, hidden: false, transitions };
}

function sceneTracks({
	main,
	overlay = [],
}: {
	main: VideoTrack;
	overlay?: VideoTrack[];
}): SceneTracks {
	return { main, overlay, audio: [] };
}

const transition = (overrides: Partial<TrackTransition> = {}): TrackTransition => ({
	id: "tr",
	type: "crossfade",
	fromElementId: "a",
	toElementId: "b",
	duration: t(20),
	params: {},
	...overrides,
});

describe("findCuts", () => {
	test("returns adjacent visible pairs in time order", () => {
		const track = videoTrack({
			elements: [
				clip({ id: "c", start: 200, duration: 100 }),
				clip({ id: "a", start: 0, duration: 100 }),
				clip({ id: "b", start: 100, duration: 100 }),
				clip({ id: "d", start: 350, duration: 100 }),
			],
		});
		expect(findCuts({ track })).toEqual([
			{ trackId: "main", fromElementId: "a", toElementId: "b", time: 100 },
			{ trackId: "main", fromElementId: "b", toElementId: "c", time: 200 },
		]);
	});

	test("ignores hidden clips", () => {
		const track = videoTrack({
			elements: [
				clip({ id: "a", start: 0, duration: 100 }),
				clip({ id: "b", start: 100, duration: 100, hidden: true }),
			],
		});
		expect(findCuts({ track })).toEqual([]);
	});
});

describe("findCutNearTime", () => {
	const track = videoTrack({
		elements: [
			clip({ id: "a", start: 0, duration: 100 }),
			clip({ id: "b", start: 100, duration: 100 }),
			clip({ id: "c", start: 200, duration: 100 }),
		],
	});

	test("finds the nearest cut within tolerance", () => {
		expect(findCutNearTime({ track, time: 195, tolerance: 10 })?.toElementId).toBe("c");
		expect(findCutNearTime({ track, time: 104, tolerance: 10 })?.toElementId).toBe("b");
	});

	test("returns null outside tolerance", () => {
		expect(findCutNearTime({ track, time: 150, tolerance: 10 })).toBeNull();
	});
});

describe("getElementCut", () => {
	const track = videoTrack({
		elements: [
			clip({ id: "a", start: 0, duration: 100 }),
			clip({ id: "b", start: 100, duration: 100 }),
		],
	});

	test("prefers the outgoing cut", () => {
		expect(getElementCut({ track, elementId: "a" })?.toElementId).toBe("b");
	});

	test("falls back to the incoming cut", () => {
		expect(getElementCut({ track, elementId: "b" })?.fromElementId).toBe("a");
	});

	test("returns null for a clip without neighbours", () => {
		const lone = videoTrack({ elements: [clip({ id: "x", start: 0, duration: 10 })] });
		expect(getElementCut({ track: lone, elementId: "x" })).toBeNull();
	});
});

describe("transition edits", () => {
	const base = () =>
		sceneTracks({
			main: videoTrack({
				elements: [
					clip({ id: "a", start: 0, duration: 100 }),
					clip({ id: "b", start: 100, duration: 100 }),
				],
			}),
			overlay: [
				videoTrack({
					id: "ov",
					elements: [
						clip({ id: "x", start: 0, duration: 50 }),
						clip({ id: "y", start: 50, duration: 50 }),
					],
				}),
			],
		});

	test("setTransitionOnCut adds and replaces on the same cut", () => {
		const cut = { trackId: "main", fromElementId: "a", toElementId: "b", time: 100 };
		const once = setTransitionOnCut({ tracks: base(), cut, transition: transition({ id: "1" }) });
		const twice = setTransitionOnCut({
			tracks: once,
			cut,
			transition: transition({ id: "2", type: "whip-pan" }),
		});
		expect(twice.main.transitions).toEqual([transition({ id: "2", type: "whip-pan" })]);
	});

	test("setTransitionOnCut works on overlay video tracks", () => {
		const cut = { trackId: "ov", fromElementId: "x", toElementId: "y", time: 50 };
		const result = setTransitionOnCut({
			tracks: base(),
			cut,
			transition: transition({ fromElementId: "x", toElementId: "y" }),
		});
		expect(getVideoTrackById({ tracks: result, trackId: "ov" })?.transitions).toHaveLength(1);
		expect(result.main.transitions).toEqual([]);
	});

	test("updateTransition patches fields", () => {
		const tracks = sceneTracks({ main: { ...base().main, transitions: [transition()] } });
		const result = updateTransition({
			tracks,
			trackId: "main",
			transitionId: "tr",
			patch: { duration: t(40), params: { strength: 0.5 } },
		});
		expect(result.main.transitions?.[0]).toEqual(
			transition({ duration: t(40), params: { strength: 0.5 } }),
		);
	});

	test("removeTransition removes by id", () => {
		const tracks = sceneTracks({ main: { ...base().main, transitions: [transition()] } });
		expect(removeTransition({ tracks, trackId: "main", transitionId: "tr" }).main.transitions).toEqual([]);
	});
});

describe("moveTransitionsToSplitRightHalves", () => {
	const incoming = transition({ id: "in", fromElementId: "x", toElementId: "a" });
	const outgoing = transition({ id: "out", fromElementId: "a", toElementId: "b" });
	// "a" (100-200) was split at 150: the left half keeps "a", the right half is "a2".
	const splitTracks = ({ keepLeft = true }: { keepLeft?: boolean } = {}) =>
		sceneTracks({
			main: videoTrack({
				elements: [
					clip({ id: "x", start: 0, duration: 100 }),
					...(keepLeft ? [clip({ id: "a", start: 100, duration: 50 })] : []),
					clip({ id: "a2", start: 150, duration: 50 }),
					clip({ id: "b", start: 200, duration: 100 }),
				],
				transitions: [incoming, outgoing],
			}),
		});

	test("keeps the outgoing transition on the right half and the incoming one on the left", () => {
		const result = reconcileTransitions({
			tracks: moveTransitionsToSplitRightHalves({
				tracks: splitTracks(),
				rightHalfIds: new Map([["a", "a2"]]),
			}),
		});
		expect(result.main.transitions).toEqual([
			incoming,
			{ ...outgoing, fromElementId: "a2" },
		]);
	});

	test("keeps the outgoing transition when only the right half is kept", () => {
		const result = reconcileTransitions({
			tracks: moveTransitionsToSplitRightHalves({
				tracks: splitTracks({ keepLeft: false }),
				rightHalfIds: new Map([["a", "a2"]]),
			}),
		});
		expect(result.main.transitions).toEqual([{ ...outgoing, fromElementId: "a2" }]);
	});

	test("returns the same object when nothing was split", () => {
		const tracks = splitTracks();
		expect(moveTransitionsToSplitRightHalves({ tracks, rightHalfIds: new Map() })).toBe(tracks);
	});
});

describe("restoreTransitionsAfterRipple", () => {
	// No test for commands without timing changes: applyRippleIfEnabled returns
	// before restoring when there are no ripple adjustments.

	test("restores a transition whose cut re-formed after a rippled trim", () => {
		const beforeTracks = sceneTracks({
			main: videoTrack({
				elements: [
					clip({ id: "a", start: 0, duration: 100 }),
					clip({ id: "b", start: 100, duration: 100 }),
				],
				transitions: [transition()],
			}),
		});
		// A's end was trimmed to 80 (which dropped the transition), then ripple closed the gap.
		const rippled = sceneTracks({
			main: videoTrack({
				elements: [
					clip({ id: "a", start: 0, duration: 80 }),
					clip({ id: "b", start: 80, duration: 100 }),
				],
			}),
		});
		const result = reconcileTransitions({
			tracks: restoreTransitionsAfterRipple({ beforeTracks, tracks: rippled }),
		});
		expect(result.main.transitions).toEqual([transition()]);
	});

	test("does not keep transitions of a deleted clip", () => {
		const beforeTracks = sceneTracks({
			main: videoTrack({
				elements: [
					clip({ id: "a", start: 0, duration: 100 }),
					clip({ id: "b", start: 100, duration: 100 }),
					clip({ id: "c", start: 200, duration: 100 }),
				],
				transitions: [transition(), transition({ id: "bc", fromElementId: "b", toElementId: "c" })],
			}),
		});
		// B was deleted, then ripple moved C up against A.
		const rippled = sceneTracks({
			main: videoTrack({
				elements: [
					clip({ id: "a", start: 0, duration: 100 }),
					clip({ id: "c", start: 100, duration: 100 }),
				],
			}),
		});
		const result = reconcileTransitions({
			tracks: restoreTransitionsAfterRipple({ beforeTracks, tracks: rippled }),
		});
		expect(result.main.transitions).toEqual([]);
	});

	test("keeps the current transition when both have the same id", () => {
		const beforeTracks = sceneTracks({
			main: videoTrack({
				elements: [
					clip({ id: "a", start: 0, duration: 100 }),
					clip({ id: "b", start: 100, duration: 100 }),
				],
				transitions: [transition()],
			}),
		});
		// The command changed the transition; the old entry must not come back.
		const changed = transition({ type: "whip-pan", duration: t(40) });
		const current = sceneTracks({
			main: videoTrack({
				elements: [
					clip({ id: "a", start: 0, duration: 100 }),
					clip({ id: "b", start: 100, duration: 100 }),
				],
				transitions: [changed],
			}),
		});
		const result = reconcileTransitions({
			tracks: restoreTransitionsAfterRipple({ beforeTracks, tracks: current }),
		});
		expect(result.main.transitions).toEqual([changed]);
	});
});

describe("reconcileTransitions", () => {
	test("returns the same object when nothing changes", () => {
		const tracks = sceneTracks({
			main: videoTrack({
				elements: [
					clip({ id: "a", start: 0, duration: 100 }),
					clip({ id: "b", start: 100, duration: 100 }),
				],
				transitions: [transition()],
			}),
		});
		expect(reconcileTransitions({ tracks })).toBe(tracks);
	});

	test("drops transitions whose clips are no longer adjacent or missing", () => {
		const tracks = sceneTracks({
			main: videoTrack({
				elements: [
					clip({ id: "a", start: 0, duration: 100 }),
					clip({ id: "b", start: 150, duration: 100 }),
				],
				transitions: [transition(), transition({ id: "gone", toElementId: "zzz" })],
			}),
		});
		expect(reconcileTransitions({ tracks }).main.transitions).toEqual([]);
	});

	test("clamps durations to the shorter clip", () => {
		const tracks = sceneTracks({
			main: videoTrack({
				elements: [
					clip({ id: "a", start: 0, duration: 10 }),
					clip({ id: "b", start: 10, duration: 100 }),
				],
				transitions: [transition({ duration: t(50) })],
			}),
		});
		expect(reconcileTransitions({ tracks }).main.transitions?.[0].duration).toBe(t(10));
	});
});
