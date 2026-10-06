import { effectsRegistry } from "../registry";
import { blurEffectDefinition } from "./blur";
import { colorEffectDefinition } from "./color";
import { lutEffectDefinition } from "./lut";

const defaultEffects = [
	blurEffectDefinition,
	colorEffectDefinition,
	lutEffectDefinition,
];

export function registerDefaultEffects(): void {
	for (const definition of defaultEffects) {
		if (effectsRegistry.has(definition.type)) {
			continue;
		}
		effectsRegistry.register({
			key: definition.type,
			definition,
		});
	}
}
