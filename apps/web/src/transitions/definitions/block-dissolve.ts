import type { TransitionDefinition } from "@/transitions/types";

export const blockDissolveTransition: TransitionDefinition = {
	type: "block-dissolve",
	name: "Block Dissolve",
	group: "gaming",
	keywords: ["blocks", "dissolve", "digital"],
	shader: "block-dissolve",
	defaultDurationSeconds: 0.8,
	params: [],
	toShaderParams: () => [],
};
