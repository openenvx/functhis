import type { ExecutionStep } from './schema';

export interface PlannedStep extends ExecutionStep {
  resolvedDependsOn: string[];
}

export function resolveStepDependencies(steps: ExecutionStep[]): PlannedStep[] {
  const stepIds = new Set(steps.map((step) => step.id));
  const planned: PlannedStep[] = [];

  for (const [index, step] of steps.entries()) {
    if (step.dependsOn !== undefined) {
      for (const dependency of step.dependsOn) {
        if (!stepIds.has(dependency)) {
          throw new Error(
            `Step "${step.id}" depends on unknown step "${dependency}"`
          );
        }
      }
      planned.push({ ...step, resolvedDependsOn: [...step.dependsOn] });
      continue;
    }

    if (index === 0) {
      planned.push({ ...step, resolvedDependsOn: [] });
      continue;
    }

    const previous = steps[index - 1];
    if (!previous) {
      planned.push({ ...step, resolvedDependsOn: [] });
      continue;
    }

    planned.push({ ...step, resolvedDependsOn: [previous.id] });
  }

  return planned;
}

export function planExecutionWaves(steps: PlannedStep[]): PlannedStep[][] {
  const remaining = new Map(steps.map((step) => [step.id, step]));
  const completed = new Set<string>();
  const waves: PlannedStep[][] = [];

  while (remaining.size > 0) {
    const wave: PlannedStep[] = [];
    for (const step of remaining.values()) {
      const ready = step.resolvedDependsOn.every((dependency) =>
        completed.has(dependency)
      );
      if (ready) {
        wave.push(step);
      }
    }

    if (wave.length === 0) {
      throw new Error('Function plan contains a dependency cycle');
    }

    waves.push(wave);
    for (const step of wave) {
      remaining.delete(step.id);
      completed.add(step.id);
    }
  }

  return waves;
}

export function canParallelizeWave(
  wave: PlannedStep[],
  writesPolicy: 'deny' | 'review-required',
  getToolRisk: (toolId: string) => 'read' | 'write' | 'unknown' | undefined
): boolean {
  if (wave.length <= 1 || writesPolicy !== 'deny') {
    return false;
  }
  return wave.every((step) => getToolRisk(step.tool) === 'read');
}
