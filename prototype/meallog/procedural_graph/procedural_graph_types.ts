/**
 * Procedural Graph Core Types
 * Inspired by Lu et al. (2026) "Procedural Graphs: Self-Evolving Execution Structures for LLM Agents"
 */

export type ProceduralRelation =
  | 'precedes'
  | 'branches_to'
  | 'refines'
  | 'fallback_to'
  | 'finalizes';

export interface ProceduralTriplet {
  sourceNodeId: string;
  relation: ProceduralRelation;
  targetNodeId: string;
  conditionDescription: string;
}

export interface ProceduralGateResult {
  passed: boolean;
  errors: string[];
}

export interface ProceduralNode<TState = any> {
  id: string;
  label: string;
  purpose: string;
  allowedTransitions: string[];
  pitfalls: string[];
  condition: (state: TState) => boolean;
  situationalGuidance: (state: TState) => string;
  validateGate: (state: TState) => ProceduralGateResult;
}

export interface RejectedEdit {
  id: string;
  sourceNodeId: string;
  targetNodeId: string;
  reason: string;
  signature?: string;
}

export interface ProceduralGraphExecutionTrace {
  nodeId: string;
  stepIndex: number;
  timestamp: string;
  guidanceLengthChars: number;
  gateResult: ProceduralGateResult;
  stateSnapshotSummary: string;
}
