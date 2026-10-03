"use client";

import { useEffect, useRef, useState } from "react";
import type {
	NumberParamDefinition,
	ParamValue,
	ParamValues,
	SelectParamDefinition,
} from "@/params";
import { useEditor } from "@/editor/use-editor";
import { PropertyParamField } from "@/components/editor/panels/properties/components/property-param-field";
import {
	Section,
	SectionContent,
	SectionFields,
	SectionHeader,
	SectionTitle,
} from "@/components/section";
import { Button } from "@/components/ui/button";
import { Separator } from "@/components/ui/separator";
import { TICKS_PER_SECOND, type MediaTime } from "@/wasm";
import { removeTrackTransition, updateTrackTransition } from "../actions";
import { getVideoTrackById } from "../edit";
import { TRANSITION_DEFINITIONS, getTransitionDefinition } from "../registry";
import {
	useTransitionSelectionStore,
	type TransitionRef,
} from "../selection-store";

const TYPE_KEY = "__type";
const DURATION_KEY = "__duration";
const PARAM_PREFIX = "param:";

export function TransitionProperties({ selection }: { selection: TransitionRef }) {
	const { trackId, transitionId } = selection;
	const scene = useEditor((e) => e.scenes.getActiveSceneOrNull());
	const draft = useRef<ParamValues>({});
	const [, setRevision] = useState(0);

	const track = scene ? getVideoTrackById({ tracks: scene.tracks, trackId }) : null;
	const transition =
		track?.transitions?.find((candidate) => candidate.id === transitionId) ?? null;

	useEffect(() => {
		if (!transition) useTransitionSelectionStore.getState().clear();
	}, [transition]);

	if (!track || !transition) return null;

	const definition = getTransitionDefinition({ type: transition.type });
	if (!definition) return null;

	const from = track.elements.find((el) => el.id === transition.fromElementId);
	const to = track.elements.find((el) => el.id === transition.toElementId);
	const maxSeconds =
		from && to
			? Math.min(from.duration, to.duration) / TICKS_PER_SECOND
			: undefined;

	const typeParam: SelectParamDefinition = {
		key: "type",
		label: "Type",
		type: "select",
		default: definition.type,
		options: TRANSITION_DEFINITIONS.map((item) => ({
			value: item.type,
			label: item.name,
		})),
	};
	const durationParam: NumberParamDefinition = {
		key: "duration",
		label: "Duration",
		type: "number",
		default: definition.defaultDurationSeconds,
		min: 0.1,
		max: maxSeconds,
		step: 0.05,
	};

	const preview = (key: string) => (value: ParamValue) => {
		draft.current[key] = value;
		setRevision((revision) => revision + 1);
	};

	const commit = (key: string, apply: (value: ParamValue) => void) => () => {
		const value = draft.current[key];
		if (value === undefined) return;
		delete draft.current[key];
		apply(value);
		setRevision((revision) => revision + 1);
	};

	const update = (patch: Parameters<typeof updateTrackTransition>[0]["patch"]) =>
		updateTrackTransition({ trackId, transitionId, patch });

	return (
		<div className="flex h-full flex-col">
			<div className="border-b px-3.5 h-11 shrink-0 flex items-center">
				<SectionTitle>Transition</SectionTitle>
			</div>
			<Section showTopBorder={false}>
				<SectionHeader>
					<SectionTitle>{definition.name}</SectionTitle>
				</SectionHeader>
				<SectionContent className="p-0">
					<SectionFields>
						<div className="flex flex-col gap-3.5">
							<div className="px-4">
								<PropertyParamField
									param={typeParam}
									value={(draft.current[TYPE_KEY] as string) ?? transition.type}
									onPreview={preview(TYPE_KEY)}
									onCommit={commit(TYPE_KEY, (value) =>
										update({ type: String(value), params: {} }),
									)}
								/>
							</div>
							<Separator />
						</div>
						<div className="flex flex-col gap-3.5">
							<div className="px-4">
								<PropertyParamField
									param={durationParam}
									value={
										(draft.current[DURATION_KEY] as number) ??
										transition.duration / TICKS_PER_SECOND
									}
									onPreview={preview(DURATION_KEY)}
									onCommit={commit(DURATION_KEY, (value) =>
										update({
											duration: Math.round(
												Number(value) * TICKS_PER_SECOND,
											) as MediaTime,
										}),
									)}
								/>
							</div>
							<Separator />
						</div>
						{definition.params.map((param) => {
							const key = `${PARAM_PREFIX}${param.key}`;
							return (
								<div key={param.key} className="flex flex-col gap-3.5">
									<div className="px-4">
										<PropertyParamField
											param={param}
											value={
												draft.current[key] ??
												transition.params[param.key] ??
												param.default
											}
											onPreview={preview(key)}
											onCommit={commit(key, (value) =>
												update({
													params: { ...transition.params, [param.key]: value },
												}),
											)}
										/>
									</div>
									<Separator />
								</div>
							);
						})}
						<div className="px-4">
							<Button
								variant="destructive"
								size="sm"
								className="w-full"
								onClick={() => removeTrackTransition({ trackId, transitionId })}
							>
								Remove transition
							</Button>
						</div>
					</SectionFields>
				</SectionContent>
			</Section>
		</div>
	);
}
