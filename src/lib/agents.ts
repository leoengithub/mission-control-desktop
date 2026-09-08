import type { AgentAvailability, AgentKind } from '../contracts';

export function reconcileSelectedAgent(
  current: AgentKind | null,
  agents: AgentAvailability[],
  defaultAgent: AgentKind | null,
): AgentKind | null {
  if (current && agents.some((agent) => agent.agent === current && agent.available)) {
    return current;
  }
  if (defaultAgent && agents.some((agent) => agent.agent === defaultAgent && agent.available)) {
    return defaultAgent;
  }
  return agents.find((agent) => agent.available)?.agent ?? null;
}

export function agentDiscoveryLabel(agent: AgentAvailability): string {
  if (agent.source === 'preview_fixture') return 'Preview fixture';
  if (agent.status === 'probe_failed') return 'Probe failed';
  return agent.available ? 'Available' : 'Not found';
}

export function agentSelectionLabel(agent: AgentAvailability): string {
  const qualifier = agentDiscoveryLabel(agent);
  return agent.source === 'native' && agent.available
    ? agent.label
    : `${agent.label} (${qualifier.toLocaleLowerCase()})`;
}
