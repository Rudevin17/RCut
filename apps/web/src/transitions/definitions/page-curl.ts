import type { TransitionDefinition } from "@/transitions/types";

export const pageCurlTransition: TransitionDefinition = {
	type: "page-curl",
	name: "Page Curl",
	group: "cinematic",
	keywords: ["page", "curl", "flip", "book"],
	shader: "page-curl",
	defaultDurationSeconds: 1.2,
	params: [],
	toShaderParams: () => [],
};
