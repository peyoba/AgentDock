import React from 'react';
import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { ProjectPanel } from '../../src/renderer/components/ProjectPanel';

describe('ProjectPanel', () => {
  it('supports keyboard resizing for the project information area', () => {
    render(
      <ProjectPanel
        workspace={{ id: 'workspace-a', name: 'Workspace A', path: '/workspace-a' }}
        onCollapse={vi.fn()}
      />,
    );

    const separator = screen.getByRole('separator', { name: '调整项目信息区高度' });
    expect(separator).toHaveAttribute('aria-valuemin', '120');
    expect(separator).toHaveAttribute('aria-valuemax', '320');
    expect(separator).toHaveAttribute('aria-valuenow', '180');

    fireEvent.keyDown(separator, { key: 'ArrowUp' });
    expect(separator).toHaveAttribute('aria-valuenow', '190');

    fireEvent.keyDown(separator, { key: 'End' });
    expect(separator).toHaveAttribute('aria-valuenow', '320');

    fireEvent.keyDown(separator, { key: 'Home' });
    expect(separator).toHaveAttribute('aria-valuenow', '120');
  });
});
