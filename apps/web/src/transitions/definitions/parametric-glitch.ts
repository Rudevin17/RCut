import type { TransitionDefinition } from "@/transitions/types";

export const parametricGlitchTransition: TransitionDefinition = {
	type: "parametric-glitch",
	name: "Parametric Glitch",
	group: "gaming",
	keywords: ["glitch", "spiral", "warp"],
	shader: "parametric-glitch",
	defaultDurationSeconds: 0.8,
	params: [],
	toShaderParams: () => [],
};
