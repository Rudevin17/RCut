import { getPersistedKeybindingsState } from "../persisted-state";

/** Adds the keyframe navigation keys, leaving them alone if the user already bound them. */
export function v7ToV8({ state }: { state: unknown }): unknown {
	const v7 = getPersistedKeybindingsState({ state });
	if (!v7) return state;
	const keybindings = { ...v7.keybindings };

	keybindings["["] ??= "keyframe-previous";
	keybindings["]"] ??= "keyframe-next";

	return { ...v7, keybindings };
}
