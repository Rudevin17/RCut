import type { TransitionDefinition } from "@/transitions/types";

export const linearBlurTransition: TransitionDefinition = {
	type: "linear-blur",
	name: "Linear Blur",
	group: "cinematic",
	keywords: ["blur", "soft", "dissolve"],
	shader: "linear-blur",
	defaultDurationSeconds: 0.6,
	params: [],
	toShaderParams: () => [],
};
