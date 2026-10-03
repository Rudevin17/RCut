import { describe, expect, test } from "bun:test";
import {
	getTransitionDefinition,
	getTransitionShaderParams,
	TRANSITION_DEFINITIONS,
} from "@/transitions/registry";

describe("transition registry", () => {
	test("registers the phase 2 transitions with renderer shader ids", () => {
		expect(TRANSITION_DEFINITIONS.map((definition) => definition.shader)).toEqual([
			"crossfade",
			"whip-pan",
			"glitch-displace",
		]);
	});

	test("types are unique", () => {
		const types = TRANSITION_DEFINITIONS.map((definition) => definition.type);
		expect(new Set(types).size).toBe(types.length);
	});

	test("returns null for unknown types", () => {
		expect(getTransitionDefinition({ type: "nope" })).toBeNull();
	});

	test("fills defaults when packing shader params", () => {
		const definition = getTransitionDefinition({ type: "whip-pan" });
		if (!definition) throw new Error("whip-pan missing");
		expect(getTransitionShaderParams({ definition, params: {} })).toEqual([1, 0, 0.25]);
		expect(
			getTransitionShaderParams({ definition, params: { direction: "up", strength: 0.5 } }),
		).toEqual([0, 1, 0.5]);
	});

	test("every definition packs at most 8 params", () => {
		for (const definition of TRANSITION_DEFINITIONS) {
			expect(
				getTransitionShaderParams({ definition, params: {} }).length,
			).toBeLessThanOrEqual(8);
		}
	});
});
