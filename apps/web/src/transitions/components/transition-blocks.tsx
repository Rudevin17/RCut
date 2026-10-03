"use client";

import { ArrowRightDoubleIcon } from "@hugeicons/core-free-icons";
import { HugeiconsIcon } from "@hugeicons/react";
import { useEditor } from "@/editor/use-editor";
import type { VideoTrack } from "@/timeline";
import { useElementSelection } from "@/timeline/hooks/element/use-element-selection";
import { timelineTimeToPixels } from "@/timeline/pixel-utils";
import { getTransitionDefinition } from "@/transitions/registry";
import { useTransitionSelectionStore } from "@/transitions/selection-store";
import { planTrackTransitions } from "@/transitions/timing";
import { cn } from "@/utils/ui";

const MIN_BLOCK_WIDTH_PX = 12;
const LABEL_MIN_WIDTH_PX = 56;

export function TransitionBlocks({
	track,
	zoomLevel,
	highlightedCutTime,
	zIndex,
}: {
	track: VideoTrack;
	zoomLevel: number;
	highlightedCutTime: number | null;
	zIndex: number;
}) {
	const editor = useEditor();
	const selected = useTransitionSelectionStore((state) => state.selected);
	const select = useTransitionSelectionStore((state) => state.select);
	const { selectedElements } = useElementSelection();
	const { transitions } = planTrackTransitions({ track });

	return (
		<>
			{transitions.map(({ transition, window }) => {
				const definition = getTransitionDefinition({ type: transition.type });
				const name = definition?.name ?? "Transition";
				const centre = timelineTimeToPixels({
					time: (window.start + window.end) / 2,
					zoomLevel,
				});
				const width = Math.max(
					MIN_BLOCK_WIDTH_PX,
					timelineTimeToPixels({ time: window.end - window.start, zoomLevel }),
				);
				const isSelected =
					selectedElements.length === 0 &&
					selected?.trackId === track.id &&
					selected.transitionId === transition.id;

				return (
					<button
						key={transition.id}
						type="button"
						title={name}
						aria-label={`${name} transition`}
						aria-pressed={isSelected}
						className={cn(
							"absolute top-1/2 flex h-5 -translate-y-1/2 cursor-pointer items-center justify-center gap-1 overflow-hidden rounded-full border border-white/40 bg-black/60 px-1.5 text-[10px] text-white backdrop-blur-sm",
							isSelected && "ring-primary ring-2",
						)}
						style={{ left: centre - width / 2, width, zIndex }}
						onMouseDown={(event) => event.stopPropagation()}
						onClick={(event) => {
							event.stopPropagation();
							editor.selection.clearSelection();
							select({ trackId: track.id, transitionId: transition.id });
						}}
					>
						<HugeiconsIcon icon={ArrowRightDoubleIcon} className="size-3 shrink-0" />
						{width >= LABEL_MIN_WIDTH_PX && <span className="truncate">{name}</span>}
					</button>
				);
			})}
			{highlightedCutTime !== null && (
				<div
					className="bg-primary pointer-events-none absolute inset-y-0 w-[3px] -translate-x-1/2 rounded-full shadow-[0_0_8px_var(--color-primary)]"
					style={{
						left: timelineTimeToPixels({ time: highlightedCutTime, zoomLevel }),
						zIndex,
					}}
				/>
			)}
		</>
	);
}
