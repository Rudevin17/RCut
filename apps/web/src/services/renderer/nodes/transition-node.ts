import type { PlannedTransition } from "@/transitions/timing";
import { type AnyBaseNode, BaseNode } from "./base-node";

export interface TransitionNodeParams {
	planned: PlannedTransition;
	shader: string;
	shaderParams: number[];
	/** Nodes drawn for the outgoing clip (its blur backdrop, then the clip). */
	fromNodes: AnyBaseNode[];
	/** Nodes drawn for the incoming clip. */
	toNodes: AnyBaseNode[];
}

export interface ResolvedTransitionNodeState {
	progress: number;
}

export class TransitionNode extends BaseNode<
	TransitionNodeParams,
	ResolvedTransitionNodeState
> {}
