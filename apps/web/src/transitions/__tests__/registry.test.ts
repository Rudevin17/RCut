import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, test } from "bun:test";
import {
	getTransitionDefinition,
	getTransitionShaderParams,
	TRANSITION_DEFINITIONS,
} from "@/transitions/registry";

describe("transition registry", () => {
	test("registers every transition shader in order", () => {
		expect(TRANSITION_DEFINITIONS.map((definition) => definition.shader)).toEqual([
			"crossfade",
			"whip-pan",
			"glitch-displace",
			"glitch-memories",
			"datamosh-strip",
			"parametric-glitch",
			"doom-melt",
			"lost-signal",
			"tv-static",
			"pixelize",
			"block-dissolve",
			"rgb-split-slam",
			"zoom-punch",
			"spin-blur",
			"shake-hit",
		]);
	});

	test("shader ids match the renderer's transition registry", () => {
		const source = readFileSync(
			join(import.meta.dir, "../../../../../rust/crates/transitions/src/shaders.rs"),
			"utf8",
		);
		// rustfmt may wrap entries across lines, so allow whitespace between tokens.
		const rustIds = [...source.matchAll(/\(\s*"([a-z0-9-]+)",\s*include_str!/g)].map(
			(match) => match[1],
		);
		expect(TRANSITION_DEFINITIONS.map((definition) => definition.shader).sort()).toEqual(
			rustIds.sort(),
		);
	});

	test("RCut originals pack their params", () => {
		const pack = (type: string, params = {}) => {
			const definition = getTransitionDefinition({ type });
			if (!definition) throw new Error(`${type} missing`);
			return getTransitionShaderParams({ definition, params });
		};
		expect(pack("rgb-split-slam")).toEqual([1]);
		expect(pack("zoom-punch")).toEqual([1, 0.8]);
		expect(pack("spin-blur")).toEqual([0.5, 1]);
		expect(pack("shake-hit", { amount: 1.5 })).toEqual([1.5, 0.6]);
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
