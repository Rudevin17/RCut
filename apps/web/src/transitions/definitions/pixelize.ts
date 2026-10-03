import type { TransitionDefinition } from "@/transitions/types";

export const pixelizeTransition: TransitionDefinition = {
	type: "pixelize",
	name: "Pixelize",
	group: "gaming",
	keywords: ["pixel", "mosaic", "retro", "8-bit"],
	shader: "pixelize",
	defaultDurationSeconds: 0.8,
	params: [],
	toShaderParams: () => [],
};
