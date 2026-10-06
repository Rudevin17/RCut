import { describe, expect, test } from "bun:test";
import type {
	AnimationPath,
	ElementAnimations,
	ScalarChannel,
} from "@/animation/types";
import type { MediaTime } from "@/wasm";
import {
	KEYFRAME_ALL_PATHS,
	findAdjacentKeyframeTime,
	getKeyframeAllState,
} from "@/motion/keyframe-tools";

// Built by hand: the real upsert helpers import the wasm package, which
// cannot be loaded under `bun test`.
function keyed(
	entries: Array<[AnimationPath, number]>,
): ElementAnimations | undefined {
	const animations: ElementAnimations = {};
	for (const [propertyPath, time] of entries) {
		const channel = (animations[propertyPath] as ScalarChannel | undefined) ?? {
			keys: [],
		};
		channel.keys.push({
			id: `${propertyPath}-${time}`,
			time: time as MediaTime,
			value: 1,
			segmentToNext: "linear",
			tangentMode: "auto",
		});
		animations[propertyPath] = channel;
	}
	return animations;
}

describe("getKeyframeAllState", () => {
	test("all six paths keyed at the time is all", () => {
		const animations = keyed(KEYFRAME_ALL_PATHS.map((path) => [path, 100]));
		expect(getKeyframeAllState({ animations, localTime: 100 })).toBe("all");
	});

	test("one path keyed is some", () => {
		const animations = keyed([["opacity", 100]]);
		expect(getKeyframeAllState({ animations, localTime: 100 })).toBe("some");
	});

	test("nothing keyed at the time is none", () => {
		expect(getKeyframeAllState({ animations: undefined, localTime: 100 })).toBe(
			"none",
		);
		const animations = keyed([["opacity", 200]]);
		expect(getKeyframeAllState({ animations, localTime: 100 })).toBe("none");
	});
});

describe("findAdjacentKeyframeTime", () => {
	const animations = keyed([
		["opacity", 100],
		["transform.rotate", 300],
		["opacity", 500],
	]);

	test("finds nearest across channels", () => {
		expect(
			findAdjacentKeyframeTime({ animations, localTime: 300, direction: "previous" }),
		).toBe(100);
		expect(
			findAdjacentKeyframeTime({ animations, localTime: 300, direction: "next" }),
		).toBe(500);
		expect(
			findAdjacentKeyframeTime({ animations, localTime: 200, direction: "next" }),
		).toBe(300);
	});

	test("returns null at the ends", () => {
		expect(
			findAdjacentKeyframeTime({ animations, localTime: 100, direction: "previous" }),
		).toBeNull();
		expect(
			findAdjacentKeyframeTime({ animations, localTime: 500, direction: "next" }),
		).toBeNull();
		expect(
			findAdjacentKeyframeTime({ animations: undefined, localTime: 0, direction: "next" }),
		).toBeNull();
	});
});
