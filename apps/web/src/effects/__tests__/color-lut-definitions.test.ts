import { describe, expect, test } from "bun:test";
import type { ParamValues } from "@/params";
import type { EffectDefinition, EffectPass } from "@/effects/types";
import { colorEffectDefinition } from "@/effects/definitions/color";
import { lutEffectDefinition } from "@/effects/definitions/lut";
import { blurEffectDefinition } from "@/effects/definitions/blur";

// `@/effects` and `@/params/registry` reach `opencut-wasm`, which bun can't load,
// so this mirrors `buildDefaultParamValues` and `resolveEffectPasses` locally.
const resolve = (definition: EffectDefinition, params: ParamValues = {}): EffectPass[] => {
	const effectParams: ParamValues = {
		...Object.fromEntries(definition.params.map((param) => [param.key, param.default])),
		...params,
	};
	const args = { effectParams, width: 1920, height: 1080 };
	if (definition.renderer.buildPasses) return definition.renderer.buildPasses(args);
	return definition.renderer.passes.map((pass) => {
		const lut = pass.lut?.(args);
		return { shader: pass.shader, params: pass.params(args), ...(lut ? { lut } : {}) };
	});
};

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
