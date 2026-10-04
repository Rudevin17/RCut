import type { TransitionDefinition } from "@/transitions/types";

export const crosswarpTransition: TransitionDefinition = {
	type: "crosswarp",
	name: "Crosswarp",
	group: "cinematic",
	keywords: ["warp", "stretch"],
	shader: "crosswarp",
	defaultDurationSeconds: 0.8,
	params: [],
	toShaderParams: () => [],
};
