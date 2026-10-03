import type { TransitionDefinition } from "@/transitions/types";

export const lostSignalTransition: TransitionDefinition = {
	type: "lost-signal",
	name: "Lost Signal",
	group: "gaming",
	keywords: ["tv", "signal", "vhs", "scanline"],
	shader: "lost-signal",
	defaultDurationSeconds: 0.6,
	params: [],
	toShaderParams: () => [],
};
