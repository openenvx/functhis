import { analyzeDataflow } from '../trace/dataflow';
import type { ExecutionTrace } from '../trace/schema';
import type { GraphStore } from './store';

export function indexRunNode(store: GraphStore, trace: ExecutionTrace): void {
  const analysis = analyzeDataflow(trace);
  const now = Date.now();
  const runNodeId = `run:${trace.id}`;

  store.upsertNode({
    attrs: {
      callCount: trace.calls.length,
      endedAt: trace.endedAt,
      readOnly: analysis.readOnly,
      startedAt: trace.startedAt,
      status: trace.status,
      toolSequence: analysis.toolSequence,
      totalDurationMs: analysis.totalDurationMs,
      totalIntermediateBytes: analysis.totalIntermediateBytes,
      totalIntermediateTokens: analysis.totalIntermediateTokens,
    },
    id: runNodeId,
    kind: 'run',
    name: trace.id,
    updatedAt: now,
  });

  for (const capability of analysis.capabilities) {
    const toolNodeId = capability.toolId;
    store.upsertEdge({
      attrs: { sideEffect: capability.sideEffect },
      fromId: runNodeId,
      kind: 'uses_tool',
      toId: toolNodeId,
    });
  }
}
