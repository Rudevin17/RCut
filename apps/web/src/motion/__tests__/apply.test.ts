import { describe, expect, test } from "bun:test";
import { applyMotion, getMotionDelta, resolveMotionPhases } from "@/motion/apply";
import { splitMotion } from "@/motion/split";

const canvas = { width: 1920, height: 1080 };
const transform = { position: { x: 100, y: 50 }, scaleX: 2, scaleY: 1, rotate: 10 };

describe("resolveMotionPhases", () => {
	test("keeps durations that fit", () => {
		expect(resolveMotionPhases({ motion: { in: { preset: "fade-in", duration: 0.5 }, out: { preset: "fade-out", duration: 1 } }, duration: 4 })).toEqual({ inDur: 0.5, outDur: 1 });
	});

	test("squeezes overlapping In/Out proportionally", () => {
		expect(resolveMotionPhases({ motion: { in: { preset: "fade-in", duration: 2 }, out: { preset: "fade-out", duration: 2 } }, duration: 2 })).toEqual({ inDur: 1, outDur: 1 });
	});

	test("ignores invalid durations", () => {
		expect(resolveMotionPhases({ motion: { in: { preset: "fade-in", duration: 0 } }, duration: 3 })).toEqual({ inDur: 0, outDur: 0 });
	});
});

describe("getMotionDelta", () => {
	test("no motion is identity", () => {
		expect(getMotionDelta({ motion: undefined, localTime: 1, duration: 3, canvas })).toEqual({ dx: 0, dy: 0, scale: 1, rotate: 0, opacity: 1 });
	});

	test("In applies only during its window, Out only during its window", () => {
		const motion = { in: { preset: "fade-in" as const, duration: 1 }, out: { preset: "fade-out" as const, duration: 1 } };
		expect(getMotionDelta({ motion, localTime: 0, duration: 4, canvas }).opacity).toBeCloseTo(0, 6);
		expect(getMotionDelta({ motion, localTime: 2, duration: 4, canvas }).opacity).toBeCloseTo(1, 6);
		expect(getMotionDelta({ motion, localTime: 4, duration: 4, canvas }).opacity).toBeCloseTo(0, 6);
	});

	test("combo period is 2 / speed seconds", () => {
		const motion = { combo: { preset: "sway" as const, speed: 2 } };
		const a = getMotionDelta({ motion, localTime: 0.3, duration: 10, canvas });
		const b = getMotionDelta({ motion, localTime: 1.3, duration: 10, canvas });
		expect(a.rotate).toBeCloseTo(b.rotate, 6);
	});
});

describe("applyMotion", () => {
	test("composes deltas onto the keyframed transform and opacity", () => {
		const result = applyMotion({
			transform,
			opacity: 0.8,
			motion: { in: { preset: "slide-left", duration: 1 }, combo: { preset: "pulse", speed: 1 } },
			localTime: 0,
			duration: 4,
			canvas,
		});
		expect(result.transform.position.x).toBeCloseTo(100 - 1920, 6);
		expect(result.transform.position.y).toBeCloseTo(50, 6);
		expect(result.transform.scaleX).toBeCloseTo(2, 6);
		expect(result.transform.rotate).toBeCloseTo(10, 6);
		expect(result.opacity).toBeCloseTo(0.8, 6);
	});

	test("no motion returns the inputs unchanged", () => {
		const result = applyMotion({ transform, opacity: 0.5, motion: undefined, localTime: 1, duration: 2, canvas });
		expect(result.transform).toEqual(transform);
		expect(result.opacity).toBe(0.5);
	});
});

describe("splitMotion", () => {
	test("left keeps in+combo, right keeps out+combo", () => {
		const motion = { in: { preset: "fade-in" as const, duration: 1 }, out: { preset: "fade-out" as const, duration: 1 }, combo: { preset: "pulse" as const, speed: 1 } };
		expect(splitMotion({ motion })).toEqual({
			left: { in: motion.in, combo: motion.combo },
			right: { out: motion.out, combo: motion.combo },
		});
	});

	test("undefined stays undefined and empty halves become undefined", () => {
		expect(splitMotion({ motion: undefined })).toEqual({ left: undefined, right: undefined });
		expect(splitMotion({ motion: { in: { preset: "fade-in", duration: 1 } } })).toEqual({ left: { in: { preset: "fade-in", duration: 1 } }, right: undefined });
	});
});
