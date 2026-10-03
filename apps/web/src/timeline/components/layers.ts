export const TIMELINE_LAYERS = {
	trackContent: 10,
	/** Transition blocks and the cut highlight, above clips inside track content. */
	transitionBlocks: 15,
	/** A clip being dragged, above transition blocks inside track content. */
	draggedElement: 16,
	dragLine: 20,
	playhead: 30,
	snapIndicator: 40,
} as const;
