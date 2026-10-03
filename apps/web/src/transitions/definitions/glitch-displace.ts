import type { TransitionDefinition } from "@/transitions/types";

export const glitchDisplaceTransition: TransitionDefinition = {
	type: "glitch-displace",
	name: "Glitch Displace",
	group: "gaming",
	keywords: ["glitch", "digital", "distort"],
	shader: "glitch-displace",
	defaultDurationSeconds: 0.6,
	params: [],
	toShaderParams: () => [],
};
