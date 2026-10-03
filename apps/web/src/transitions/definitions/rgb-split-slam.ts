import { numberParam } from "@/transitions/definitions/shader-params";
import type { TransitionDefinition } from "@/transitions/types";

export const rgbSplitSlamTransition: TransitionDefinition = {
	type: "rgb-split-slam",
	name: "RGB Split Slam",
	group: "gaming",
	keywords: ["rgb", "chromatic", "impact", "hit", "punch"],
	shader: "rgb-split-slam",
	defaultDurationSeconds: 0.4,
	params: [
		{
			key: "intensity",
			label: "Intensity",
			type: "number",
			default: 1,
			min: 0.2,
			max: 2,
			step: 0.1,
		},
	],
	toShaderParams: ({ params }) => [
		numberParam({ params, key: "intensity", fallback: 1 }),
	],
};
