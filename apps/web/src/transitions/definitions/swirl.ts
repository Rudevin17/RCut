import type { TransitionDefinition } from "@/transitions/types";

export const swirlTransition: TransitionDefinition = {
	type: "swirl",
	name: "Swirl",
	group: "cinematic",
	keywords: ["swirl", "twist", "spiral"],
	shader: "swirl",
	defaultDurationSeconds: 1.0,
	params: [],
	toShaderParams: () => [],
};
