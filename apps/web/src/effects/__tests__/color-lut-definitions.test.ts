import { describe, expect, mock, test } from "bun:test";

// `@/effects` and `@/params/registry` reach `opencut-wasm` through `@/timeline` -> `@/wasm`,
// which bun can't load (wasm ESM integration). Stub what runs at import time.
const TICKS_PER_SECOND = 120_000;
mock.module("opencut-wasm", () => ({
	TICKS_PER_SECOND: () => TICKS_PER_SECOND,
	mediaTimeFromSeconds: ({ seconds }: { seconds: number }) => Math.round(seconds * TICKS_PER_SECOND),
	mediaTimeToSeconds: ({ time }: { time: number }) => time / TICKS_PER_SECOND,
	roundToFrame: () => undefined,
	snappedSeekTime: () => undefined,
	lastFrameTime: () => undefined,
	parseTimecode: () => undefined,
}));

const { buildDefaultParamValues } = await import("@/params/registry");
const { resolveEffectPasses } = await import("@/effects");
const { colorEffectDefinition } = await import("@/effects/definitions/color");
const { lutEffectDefinition } = await import("@/effects/definitions/lut");
const { blurEffectDefinition } = await import("@/effects/definitions/blur");

const resolve = (definition: typeof colorEffectDefinition, params = {}) =>
	resolveEffectPasses({
		definition,
		effectParams: { ...buildDefaultParamValues(definition.params), ...params },
		width: 1920,
		height: 1080,
	});

describe("color effect", () => {
	test("defaults are a no-op pass", () => {
		expect(resolve(colorEffectDefinition)).toEqual([{ shader: "color-adjust", params: [0, 0, 0, 0, 0, 0, 0, 0, 0, 0] }]);
	});

	test("packs controls in spec order, normalised", () => {
		const [pass] = resolve(colorEffectDefinition, {
			exposure: 1.5, contrast: 20, highlights: -30, shadows: 40, whites: 10,
			blacks: -10, saturation: 50, vibrance: -50, temperature: 100, tint: -100,
		});
		expect(pass.params).toEqual([1.5, 0.2, -0.3, 0.4, 0.1, -0.1, 0.5, -0.5, 1, -1]);
	});
});

describe("lut effect", () => {
	test("built-in default packs intensity, size and domain with the LUT id", () => {
		expect(resolve(lutEffectDefinition)).toEqual([
			{ shader: "lut-3d", lut: "builtin:teal-orange", params: [1, 33, 0, 0, 0, 1, 1, 1] },
		]);
		expect(resolve(lutEffectDefinition, { intensity: 40 })[0].params[0]).toBeCloseTo(0.4, 6);
	});

	test("an unknown LUT id produces no pass", () => {
		expect(resolve(lutEffectDefinition, { lut: "missing-id" })).toEqual([]);
	});
});

describe("blur effect", () => {
	test("keeps its sigma, step and direction in the generic params", () => {
		const passes = resolve(blurEffectDefinition, { intensity: 15 });
		expect(passes.every((pass) => pass.shader === "gaussian-blur" && pass.params.length === 4)).toBe(true);
		expect(passes[0].params.slice(2)).toEqual([1, 0]);
		expect(passes[1].params.slice(2)).toEqual([0, 1]);
	});
});
