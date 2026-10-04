import type { TransitionDefinition } from "@/transitions/types";

export const zoomInOutTransition: TransitionDefinition = {
	type: "zoom-in-out",
	name: "Zoom In/Out",
	group: "basic",
	keywords: ["zoom", "scale"],
	shader: "zoom-in-out",
	defaultDurationSeconds: 0.6,
	params: [],
	toShaderParams: () => [],
};
