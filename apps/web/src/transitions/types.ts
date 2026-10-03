import type { ParamDefinition, ParamValues } from "@/params";
import type { MediaTime } from "@/wasm";

export type TransitionGroup = "basic" | "cinematic" | "gaming";

/** A transition on the cut between two adjacent clips of a video track. */
export interface TrackTransition {
	id: string;
	type: string;
	fromElementId: string;
	toElementId: string;
	duration: MediaTime;
	params: ParamValues;
}

export interface TransitionDefinition {
	type: string;
	name: string;
	group: TransitionGroup;
	keywords: string[];
	/** Shader id registered in the renderer's transitions crate. */
	shader: string;
	defaultDurationSeconds: number;
	params: ParamDefinition[];
	/** Packs param values into the shader's param array (at most 8 numbers). */
	toShaderParams: ({ params }: { params: ParamValues }) => number[];
}
