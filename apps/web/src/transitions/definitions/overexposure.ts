import type { TransitionDefinition } from "@/transitions/types";

export const overexposureTransition: TransitionDefinition = {
	type: "overexposure",
	name: "Overexposure",
	group: "cinematic",
	keywords: ["flash", "bright", "exposure"],
	shader: "overexposure",
	defaultDurationSeconds: 0.8,
	params: [],
	toShaderParams: () => [],
};
