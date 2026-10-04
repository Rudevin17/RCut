import type { TransitionDefinition } from "@/transitions/types";

export const dreamyZoomTransition: TransitionDefinition = {
	type: "dreamy-zoom",
	name: "Dreamy Zoom",
	group: "cinematic",
	keywords: ["dream", "zoom", "glow", "rotate"],
	shader: "dreamy-zoom",
	defaultDurationSeconds: 0.8,
	params: [],
	toShaderParams: () => [],
};
