import { hasLut, registerLut } from "opencut-wasm";
import type { EffectPass } from "@/effects/types";
import { getLut } from "@/services/lut-library";

/** Uploads every LUT the passes reference that the GPU renderer doesn't have yet. */
export function ensureLutsRegistered({ passes }: { passes: EffectPass[] }): void {
	const ids = new Set<string>();
	for (const pass of passes) {
		if (pass.lut) ids.add(pass.lut);
	}
	for (const id of ids) {
		if (hasLut(id)) continue;
		const lut = getLut({ id });
		if (lut) registerLut({ id, size: lut.size, data: lut.data });
	}
}
