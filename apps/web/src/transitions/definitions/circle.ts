import type { TransitionDefinition } from "@/transitions/types";

export const circleTransition: TransitionDefinition = {
	type: "circle",
	name: "Circle",
	group: "basic",
	keywords: ["circle", "iris", "reveal"],
	shader: "circle-open",
	defaultDurationSeconds: 0.8,
	params: [],
	toShaderParams: () => [],
};
