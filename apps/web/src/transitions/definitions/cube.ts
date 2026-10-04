import type { TransitionDefinition } from "@/transitions/types";

export const cubeTransition: TransitionDefinition = {
	type: "cube",
	name: "Cube",
	group: "cinematic",
	keywords: ["cube", "3d", "rotate"],
	shader: "cube",
	defaultDurationSeconds: 1.0,
	params: [],
	toShaderParams: () => [],
};
