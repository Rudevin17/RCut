import type { EffectDefinition } from "@/effects/types";
import { getLut } from "@/services/lut-library";

export const DEFAULT_LUT_ID = "builtin:teal-orange";

export const lutEffectDefinition: EffectDefinition = {
	type: "lut",
	name: "LUT",
	keywords: ["lut", "look", "cube", "grade", "film", "cinematic"],
	params: [
		{ key: "lut", label: "Look", type: "lut", default: DEFAULT_LUT_ID },
		{ key: "intensity", label: "Intensity", type: "number", default: 100, min: 0, max: 100, step: 1, slider: true },
	],
	renderer: {
		passes: [],
		buildPasses: ({ effectParams }) => {
			const id = typeof effectParams.lut === "string" ? effectParams.lut : "";
			const lut = getLut({ id });
			if (!lut) return [];
			const rawIntensity = effectParams.intensity;
			const intensity =
				typeof rawIntensity === "number" && Number.isFinite(rawIntensity) ? rawIntensity : 100;
			return [
				{
					shader: "lut-3d",
					lut: id,
					// params: [intensity, size, domainMin.rgb, domainMax.rgb]
					params: [intensity / 100, lut.size, ...lut.domainMin, ...lut.domainMax],
				},
			];
		},
	},
};
