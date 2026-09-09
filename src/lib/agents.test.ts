import { describe, expect, it } from 'vitest';
import type { AgentAvailability } from '../contracts';
import { agentDiscoveryLabel, agentSelectionLabel, reconcileSelectedAgent } from './agents';

const agent = (overrides: Partial<AgentAvailability>): AgentAvailability => ({
  agent: 'codex',
  label: 'Codex',
  available: true,
  version: 'codex 1.0.0',
  source: 'native',
  status: 'available',
  detail: 'Detected by the packaged desktop runtime.',
  ...overrides,
});

describe('agent discovery presentation', () => {
  it('distinguishes preview fixtures, missing binaries, and failed probes', () => {
    expect(agentDiscoveryLabel(agent({ source: 'preview_fixture' }))).toBe('Preview fixture');
    expect(agentDiscoveryLabel(agent({ available: false, status: 'not_found' }))).toBe('Not found');
    expect(agentDiscoveryLabel(agent({ available: false, status: 'probe_failed' }))).toBe(
      'Probe failed',
    );
  });

  it('qualifies non-native and unavailable agents in the review selector', () => {
    expect(agentSelectionLabel(agent({ source: 'preview_fixture' }))).toBe(
      'Codex (preview fixture)',
    );
    expect(agentSelectionLabel(agent({ available: false, status: 'probe_failed' }))).toBe(
      'Codex (probe failed)',
    );
    expect(agentSelectionLabel(agent({}))).toBe('Codex');
  });
});

describe('agent selection reconciliation', () => {
  const codex = agent({});
  const claude = agent({ agent: 'claude_code', label: 'Claude Code' });

  it('keeps an available current selection', () => {
    expect(reconcileSelectedAgent('claude_code', [codex, claude], 'codex')).toBe('claude_code');
  });

  it('restores an available configured default after refresh', () => {
    expect(reconcileSelectedAgent(null, [codex, claude], 'codex')).toBe('codex');
  });

  it('drops an unavailable selection and falls back to another available agent', () => {
    const unavailableCodex = agent({ available: false, status: 'not_found' });
    expect(reconcileSelectedAgent('codex', [unavailableCodex, claude], null)).toBe('claude_code');
  });
});
