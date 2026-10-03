import type { TransitionDefinition } from "@/transitions/types";

export const glitchMemoriesTransition: TransitionDefinition = {
	type: "glitch-memories",
	name: "Glitch Memories",
	group: "gaming",
	keywords: ["glitch", "rgb", "jitter"],
	shader: "glitch-memories",
	defaultDurationSeconds: 0.6,
	params: [],
	toShaderParams: () => [],
};
