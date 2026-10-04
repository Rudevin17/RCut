"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { toast } from "sonner";
import { PanelView } from "@/components/editor/panels/assets/views/base-panel";
import { DraggableItem } from "@/components/editor/panels/assets/draggable-item";
import { Input } from "@/components/ui/input";
import { transitionPreviewService } from "@/services/renderer/transition-preview";
import { applyTransitionToSelectedClip } from "@/transitions/actions";
import { TRANSITION_DEFINITIONS } from "@/transitions/registry";
import type { TransitionDefinition, TransitionGroup } from "@/transitions/types";

const GROUPS: Array<{ group: TransitionGroup; label: string }> = [
	{ group: "basic", label: "Basic" },
	{ group: "cinematic", label: "Cinematic" },
	{ group: "gaming", label: "Gaming" },
];

export function TransitionsView() {
	const [query, setQuery] = useState("");
	const normalized = query.trim().toLowerCase();
	const matches = (definition: TransitionDefinition) =>
		!normalized ||
		definition.name.toLowerCase().includes(normalized) ||
		definition.keywords.some((keyword) => keyword.includes(normalized));

	return (
		<PanelView title="Transitions">
			<div className="flex flex-col gap-4">
				<Input
					placeholder="Search transitions"
					value={query}
					onChange={(event) => setQuery(event.target.value)}
				/>
				{GROUPS.map(({ group, label }) => {
					const definitions = TRANSITION_DEFINITIONS.filter(
						(definition) => definition.group === group && matches(definition),
					);
					if (definitions.length === 0) return null;
					return (
						<section key={group} className="flex flex-col gap-2">
							<h3 className="text-muted-foreground text-xs font-medium">{label}</h3>
							<div
								className="grid gap-2"
								style={{ gridTemplateColumns: "repeat(auto-fill, minmax(120px, 1fr))" }}
							>
								{definitions.map((definition) => (
									<TransitionItem key={definition.type} definition={definition} />
								))}
							</div>
						</section>
					);
				})}
			</div>
		</PanelView>
	);
}

function TransitionPreviewCanvas({ type }: { type: string }) {
	const canvasRef = useRef<HTMLCanvasElement>(null);
	const frameRef = useRef<number | null>(null);

	const render = useCallback(
		(progress: number) => {
			if (canvasRef.current) {
				transitionPreviewService.renderPreview({
					type,
					progress,
					targetCanvas: canvasRef.current,
				});
			}
		},
		[type],
	);

	useEffect(() => {
		render(0.5);
		return transitionPreviewService.onPreviewImageReady({ callback: () => render(0.5) });
	}, [render]);

	const startAnimation = () => {
		if (frameRef.current !== null) cancelAnimationFrame(frameRef.current);
		const start = performance.now();
		const tick = (now: number) => {
			render(((now - start) % 1200) / 1200);
			frameRef.current = requestAnimationFrame(tick);
		};
		frameRef.current = requestAnimationFrame(tick);
	};

	const stopAnimation = () => {
		if (frameRef.current !== null) cancelAnimationFrame(frameRef.current);
		frameRef.current = null;
		render(0.5);
	};

	useEffect(() => () => {
		if (frameRef.current !== null) cancelAnimationFrame(frameRef.current);
	}, []);

	return (
		<canvas
			ref={canvasRef}
			className="size-full"
			onMouseEnter={startAnimation}
			onMouseLeave={stopAnimation}
		/>
	);
}

function TransitionItem({ definition }: { definition: TransitionDefinition }) {
	const handleAdd = useCallback(() => {
		if (!applyTransitionToSelectedClip({ type: definition.type })) {
			toast.info("Select a clip next to a cut, or drag the transition onto a cut");
		}
	}, [definition.type]);

	return (
		<DraggableItem
			name={definition.name}
			preview={<TransitionPreviewCanvas type={definition.type} />}
			dragData={{
				id: definition.type,
				name: definition.name,
				type: "transition",
				transitionType: definition.type,
			}}
			onAddToTimeline={handleAdd}
			aspectRatio={16 / 9}
			isRounded
			variant="card"
			containerClassName="w-full"
		/>
	);
}
