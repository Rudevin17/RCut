import type { TransitionDefinition } from "@/transitions/types";

export const doomMeltTransition: TransitionDefinition = {
	type: "doom-melt",
	name: "Doom Melt",
	group: "gaming",
	keywords: ["doom", "melt", "retro", "drip"],
	shader: "doom-melt",
	defaultDurationSeconds: 1.0,
	params: [],
	toShaderParams: () => [],
};
