import type { ParamValues } from "@/params";
import { TRANSITION_DEFINITIONS } from "./definitions";
import type { TransitionDefinition } from "./types";

export { TRANSITION_DEFINITIONS };

const definitionsByType = new Map(
	TRANSITION_DEFINITIONS.map((definition) => [definition.type, definition]),
);

export function getTransitionDefinition({
	type,
}: {
	type: string;
}): TransitionDefinition | null {
	return definitionsByType.get(type) ?? null;
}

export function getTransitionShaderParams({
	definition,
	params,
}: {
	definition: TransitionDefinition;
	params: ParamValues;
}): number[] {
	const defaults: ParamValues = Object.fromEntries(
		definition.params.map((param) => [param.key, param.default]),
	);
	return definition.toShaderParams({ params: { ...defaults, ...params } });
}
