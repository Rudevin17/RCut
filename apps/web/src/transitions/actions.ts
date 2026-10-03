import { TracksSnapshotCommand } from "@/commands/timeline/tracks-snapshot";
import { EditorCore } from "@/core";
import { generateUUID } from "@/utils/id";
import { TICKS_PER_SECOND, type MediaTime } from "@/wasm";
import type { SceneTracks } from "@/timeline";
import {
	type Cut,
	getElementCut,
	getVideoTrackById,
	removeTransition,
	setTransitionOnCut,
	updateTransition,
} from "./edit";
import { getTransitionDefinition } from "./registry";
import { useTransitionSelectionStore } from "./selection-store";
import type { TrackTransition } from "./types";

function commitTracks({ before, after }: { before: SceneTracks; after: SceneTracks }): void {
	EditorCore.getInstance().command.execute({
		command: new TracksSnapshotCommand({ before, after }),
	});
}

export function addTransitionAtCut({ cut, type }: { cut: Cut; type: string }): void {
	const definition = getTransitionDefinition({ type });
	if (!definition) return;

	const editor = EditorCore.getInstance();
	const before = editor.scenes.getActiveScene().tracks;
	const id = generateUUID();
	const after = setTransitionOnCut({
		tracks: before,
		cut,
		transition: {
			id,
			type,
			fromElementId: cut.fromElementId,
			toElementId: cut.toElementId,
			duration: Math.round(definition.defaultDurationSeconds * TICKS_PER_SECOND) as MediaTime,
			params: {},
		},
	});
	commitTracks({ before, after });
	editor.selection.clearSelection();
	useTransitionSelectionStore.getState().select({ trackId: cut.trackId, transitionId: id });
}

/** Applies a transition to the selected clip's outgoing cut (or incoming, if last). */
export function applyTransitionToSelectedClip({ type }: { type: string }): boolean {
	const editor = EditorCore.getInstance();
	const [selected] = editor.selection.getSelectedElements();
	if (!selected) return false;

	const track = getVideoTrackById({
		tracks: editor.scenes.getActiveScene().tracks,
		trackId: selected.trackId,
	});
	const cut = track ? getElementCut({ track, elementId: selected.elementId }) : null;
	if (!cut) return false;

	addTransitionAtCut({ cut, type });
	return true;
}

export function updateTrackTransition({
	trackId,
	transitionId,
	patch,
}: {
	trackId: string;
	transitionId: string;
	patch: Partial<Pick<TrackTransition, "type" | "duration" | "params">>;
}): void {
	const before = EditorCore.getInstance().scenes.getActiveScene().tracks;
	commitTracks({ before, after: updateTransition({ tracks: before, trackId, transitionId, patch }) });
}

export function removeTrackTransition({
	trackId,
	transitionId,
}: {
	trackId: string;
	transitionId: string;
}): void {
	const before = EditorCore.getInstance().scenes.getActiveScene().tracks;
	commitTracks({ before, after: removeTransition({ tracks: before, trackId, transitionId }) });
	useTransitionSelectionStore.getState().clear();
}
