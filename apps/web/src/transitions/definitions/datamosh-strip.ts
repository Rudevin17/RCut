import type { TransitionDefinition } from "@/transitions/types";

export const datamoshStripTransition: TransitionDefinition = {
	type: "datamosh-strip",
	name: "Datamosh Strip",
	group: "gaming",
	keywords: ["datamosh", "glitch", "tear", "broadcast"],
	shader: "datamosh-strip",
	defaultDurationSeconds: 0.8,
	params: [],
	toShaderParams: () => [],
};
