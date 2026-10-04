import type { TransitionDefinition } from "@/transitions/types";

export const dipToBlackTransition: TransitionDefinition = {
	type: "dip-to-black",
	name: "Dip to Black",
	group: "basic",
	keywords: ["fade", "black", "dip"],
	shader: "fade-color",
	defaultDurationSeconds: 0.8,
	params: [],
	toShaderParams: () => [0, 0, 0, 0.4],
};
