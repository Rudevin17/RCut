import type { TransitionDefinition } from "@/transitions/types";

export const tvStaticTransition: TransitionDefinition = {
	type: "tv-static",
	name: "TV Static",
	group: "gaming",
	keywords: ["static", "noise", "tv"],
	shader: "tv-static",
	defaultDurationSeconds: 0.4,
	params: [],
	toShaderParams: () => [],
};
