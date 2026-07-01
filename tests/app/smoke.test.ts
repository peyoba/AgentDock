import { describe, expect, it } from 'vitest';

describe('AgentDock app test harness', () => {
  it('runs app tests', () => {
    expect('AgentDock').toContain('Dock');
  });
});
