"use client";

import { create } from "zustand";

export interface TransitionRef {
	trackId: string;
	transitionId: string;
}

interface TransitionSelectionState {
	selected: TransitionRef | null;
	select: (ref: TransitionRef) => void;
	clear: () => void;
}

export const useTransitionSelectionStore = create<TransitionSelectionState>()((set) => ({
	selected: null,
	select: (ref) => set({ selected: ref }),
	clear: () => set({ selected: null }),
}));
