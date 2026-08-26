import type { Workflow } from "./workflow";

/**
 * The workflow registry. KPI #1's unit is an entry in here: not an agent, not a
 * file, not a phase. Counting anything else is how "two working workflows"
 * quietly becomes a number nobody can reproduce.
 */
const registry = new Map<string, Workflow>();

const WORKFLOW_ID = /^[A-Z]\d+\.[a-z][a-z0-9-]*$/;

export class InvalidWorkflowError extends Error {
  constructor(id: string, reason: string) {
    super(`Workflow "${id}" is not registrable: ${reason}`);
    this.name = "InvalidWorkflowError";
  }
}

/**
 * Registration is where the contract is enforced. A workflow missing its
 * owner, tools, handoff or measures is refused here rather than discovered
 * missing in Phase 11, when the agent specifications are generated from these
 * fields.
 */
export function assertRegistrable(workflow: Workflow): void {
  const { id } = workflow;
  if (!WORKFLOW_ID.test(id)) {
    throw new InvalidWorkflowError(id, "the id must look like S1.ingest");
  }
  if (!workflow.goal.trim()) {
    throw new InvalidWorkflowError(id, "goal is required");
  }
  const owner = workflow.owner.trim();
  if (!owner || /^(the )?system$/i.test(owner)) {
    throw new InvalidWorkflowError(
      id,
      "owner must be a person, never a system",
    );
  }
  if (workflow.tools.length === 0) {
    throw new InvalidWorkflowError(
      id,
      "tools must list every API, adapter and table it may touch",
    );
  }
  if (workflow.steps.length === 0) {
    throw new InvalidWorkflowError(id, "steps are required");
  }
  if (workflow.outputs.length === 0) {
    throw new InvalidWorkflowError(
      id,
      "outputs must declare shape and destination",
    );
  }
  if (!workflow.handoff.to.trim() || !workflow.handoff.state.trim()) {
    throw new InvalidWorkflowError(
      id,
      "handoff must name who receives the output and in what state",
    );
  }
  if (workflow.measures.length === 0) {
    throw new InvalidWorkflowError(id, "measures must name the KPIs it feeds");
  }
  const stepIds = new Set(workflow.steps.map((step) => step.id));
  if (stepIds.size !== workflow.steps.length) {
    throw new InvalidWorkflowError(id, "step ids must be unique");
  }
  if (stepIds.has("handoff")) {
    throw new InvalidWorkflowError(
      id,
      '"handoff" is reserved for the recorded handoff stage',
    );
  }
}

export function registerWorkflow(workflow: Workflow): Workflow {
  assertRegistrable(workflow);
  registry.set(workflow.id, workflow);
  return workflow;
}

export function getWorkflow(id: string): Workflow | undefined {
  return registry.get(id);
}

export function listWorkflows(): Workflow[] {
  return [...registry.values()];
}

export function registeredWorkflowIds(): string[] {
  return [...registry.keys()].sort();
}

/** Test-only: the registry is module state, so a suite can start clean. */
export function clearRegistry(): void {
  registry.clear();
}
