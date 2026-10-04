import type { TransitionDefinition } from "@/transitions/types";

export const filmBurnTransition: TransitionDefinition = {
	type: "film-burn",
	name: "Film Burn",
	group: "cinematic",
	keywords: ["film", "burn", "light leak", "vintage"],
	shader: "film-burn",
	defaultDurationSeconds: 1.2,
	params: [],
	toShaderParams: () => [],
};
