import type { SceneTracks, TimelineElement, VideoTrack } from "@/timeline";
import type { MediaTime } from "@/wasm";
import type { TrackTransition } from "./types";

export interface Cut {
	trackId: string;
	fromElementId: string;
	toElementId: string;
	time: number;
}

function isHidden({ element }: { element: TimelineElement }): boolean {
	return "hidden" in element && element.hidden === true;
}

export function findCuts({ track }: { track: VideoTrack }): Cut[] {
	const elements = track.elements
		.filter((element) => !isHidden({ element }))
		.slice()
		.sort((a, b) => a.startTime - b.startTime);
	const cuts: Cut[] = [];
	for (let index = 1; index < elements.length; index++) {
		const from = elements[index - 1];
		const to = elements[index];
		const time = from.startTime + from.duration;
		if (time === to.startTime) {
			cuts.push({ trackId: track.id, fromElementId: from.id, toElementId: to.id, time });
		}
	}
	return cuts;
}

export function findCutNearTime({
	track,
	time,
	tolerance,
}: {
	track: VideoTrack;
	time: number;
	tolerance: number;
}): Cut | null {
	let nearest: Cut | null = null;
	for (const cut of findCuts({ track })) {
		const distance = Math.abs(cut.time - time);
		if (distance > tolerance) continue;
		if (!nearest || distance < Math.abs(nearest.time - time)) {
			nearest = cut;
		}
	}
	return nearest;
}

export function getElementCut({
	track,
	elementId,
}: {
	track: VideoTrack;
	elementId: string;
}): Cut | null {
	const cuts = findCuts({ track });
	return (
		cuts.find((cut) => cut.fromElementId === elementId) ??
		cuts.find((cut) => cut.toElementId === elementId) ??
		null
	);
}

export function getVideoTrackById({
	tracks,
	trackId,
}: {
	tracks: SceneTracks;
	trackId: string;
}): VideoTrack | null {
	if (tracks.main.id === trackId) return tracks.main;
	const overlay = tracks.overlay.find((track) => track.id === trackId);
	return overlay?.type === "video" ? overlay : null;
}

function mapVideoTrack({
	tracks,
	trackId,
	update,
}: {
	tracks: SceneTracks;
	trackId: string;
	update: (track: VideoTrack) => VideoTrack;
}): SceneTracks {
	if (tracks.main.id === trackId) {
		return { ...tracks, main: update(tracks.main) };
	}
	return {
		...tracks,
		overlay: tracks.overlay.map((track) =>
			track.id === trackId && track.type === "video" ? update(track) : track,
		),
	};
}

export function setTransitionOnCut({
	tracks,
	cut,
	transition,
}: {
	tracks: SceneTracks;
	cut: Cut;
	transition: TrackTransition;
}): SceneTracks {
	return mapVideoTrack({
		tracks,
		trackId: cut.trackId,
		update: (track) => ({
			...track,
			transitions: [
				...(track.transitions ?? []).filter(
					(existing) =>
						!(
							existing.fromElementId === cut.fromElementId &&
							existing.toElementId === cut.toElementId
						),
				),
				{ ...transition, fromElementId: cut.fromElementId, toElementId: cut.toElementId },
			],
		}),
	});
}

export function updateTransition({
	tracks,
	trackId,
	transitionId,
	patch,
}: {
	tracks: SceneTracks;
	trackId: string;
	transitionId: string;
	patch: Partial<Pick<TrackTransition, "type" | "duration" | "params">>;
}): SceneTracks {
	return mapVideoTrack({
		tracks,
		trackId,
		update: (track) => ({
			...track,
			transitions: (track.transitions ?? []).map((transition) =>
				transition.id === transitionId ? { ...transition, ...patch } : transition,
			),
		}),
	});
}

export function removeTransition({
	tracks,
	trackId,
	transitionId,
}: {
	tracks: SceneTracks;
	trackId: string;
	transitionId: string;
}): SceneTracks {
	return mapVideoTrack({
		tracks,
		trackId,
		update: (track) => ({
			...track,
			transitions: (track.transitions ?? []).filter(
				(transition) => transition.id !== transitionId,
			),
		}),
	});
}

/**
 * After a split, the right half (new id) owns the original clip's outgoing cut,
 * so outgoing transitions move to it. Incoming transitions stay on the left
 * half, which keeps the original id.
 */
export function moveTransitionsToSplitRightHalves({
	tracks,
	rightHalfIds,
}: {
	tracks: SceneTracks;
	rightHalfIds: Map<string, string>;
}): SceneTracks {
	if (rightHalfIds.size === 0) return tracks;

	const remapTrack = (track: VideoTrack): VideoTrack => {
		if (!track.transitions?.some((transition) => rightHalfIds.has(transition.fromElementId))) {
			return track;
		}
		return {
			...track,
			transitions: track.transitions.map((transition) => {
				const rightHalfId = rightHalfIds.get(transition.fromElementId);
				return rightHalfId ? { ...transition, fromElementId: rightHalfId } : transition;
			}),
		};
	};

	return {
		...tracks,
		main: remapTrack(tracks.main),
		overlay: tracks.overlay.map((track) =>
			track.type === "video" ? remapTrack(track) : track,
		),
	};
}

/** Drops transitions whose cut no longer exists and clamps durations. */
export function reconcileTransitions({ tracks }: { tracks: SceneTracks }): SceneTracks {
	let changed = false;

	const reconcileTrack = (track: VideoTrack): VideoTrack => {
		if (!track.transitions?.length) return track;
		const elementsById = new Map(track.elements.map((element) => [element.id, element]));
		const next: TrackTransition[] = [];
		for (const transition of track.transitions) {
			const from = elementsById.get(transition.fromElementId);
			const to = elementsById.get(transition.toElementId);
			if (!from || !to || from.startTime + from.duration !== to.startTime) {
				changed = true;
				continue;
			}
			const maxDuration = Math.min(from.duration, to.duration);
			if (transition.duration > maxDuration) {
				changed = true;
				next.push({ ...transition, duration: maxDuration as MediaTime });
				continue;
			}
			next.push(transition);
		}
		return next.length === track.transitions.length &&
			next.every((transition, index) => transition === track.transitions?.[index])
			? track
			: { ...track, transitions: next };
	};

	const main = reconcileTrack(tracks.main);
	const overlay = tracks.overlay.map((track) =>
		track.type === "video" ? reconcileTrack(track) : track,
	);
	return changed ? { ...tracks, main, overlay } : tracks;
}
