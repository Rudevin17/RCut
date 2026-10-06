import type { ParamDefinition, ParamValues } from "@/params";

export interface Effect {
	id: string;
	type: string;
	params: ParamValues;
	enabled: boolean;
}

export interface EffectPass {
	shader: string;
	/** Shader parameters, packed in the order the shader expects (at most 16). */
	params: number[];
	/** Id of a registered 3D LUT the shader samples, if any. */
	lut?: string;
}

interface EffectPassArgs {
	effectParams: ParamValues;
	width: number;
	height: number;
}

export interface EffectPassTemplate {
	shader: string;
	params(args: EffectPassArgs): number[];
	lut?(args: EffectPassArgs): string | undefined;
}

export interface EffectRendererConfig {
	passes: EffectPassTemplate[];
	buildPasses?: (params: EffectPassArgs) => EffectPass[];
}

export interface EffectDefinition {
	type: string;
	name: string;
	keywords: string[];
	params: ParamDefinition[];
	renderer: EffectRendererConfig;
}
