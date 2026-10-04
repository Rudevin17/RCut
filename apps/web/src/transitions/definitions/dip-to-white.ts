import type { TransitionDefinition } from "@/transitions/types";

export const dipToWhiteTransition: TransitionDefinition = {
	type: "dip-to-white",
	name: "Dip to White",
	group: "basic",
	keywords: ["fade", "white", "flash", "dip"],
	shader: "fade-color",
	defaultDurationSeconds: 0.8,
	params: [],
	toShaderParams: () => [1, 1, 1, 0.4],
};
