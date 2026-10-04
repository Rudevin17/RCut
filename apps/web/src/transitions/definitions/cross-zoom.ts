import type { TransitionDefinition } from "@/transitions/types";

export const crossZoomTransition: TransitionDefinition = {
	type: "cross-zoom",
	name: "Cross Zoom",
	group: "cinematic",
	keywords: ["zoom", "blur", "dissolve"],
	shader: "cross-zoom",
	defaultDurationSeconds: 1.0,
	params: [],
	toShaderParams: () => [],
};
