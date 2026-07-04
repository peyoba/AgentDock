import { describe, expect, it } from 'vitest';
import { defaultWorkspaces } from '../../src/shared/defaultWorkspaces';

describe('default workspaces', () => {
  it('does not point packaged app at protected macOS folders by default', () => {
    expect(defaultWorkspaces).toEqual([]);
  });
});
