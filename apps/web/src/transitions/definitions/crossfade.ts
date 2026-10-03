import type { TransitionDefinition } from "@/transitions/types";

export const crossfadeTransition: TransitionDefinition = {
	type: "crossfade",
	name: "Crossfade",
	group: "basic",
	keywords: ["fade", "dissolve", "mix"],
	shader: "crossfade",
	defaultDurationSeconds: 0.5,
	params: [],
	toShaderParams: () => [],
};
