import { describe, expect, it } from 'vitest';
import { sanitizePersistedTerminalOutput } from '../../src/main/terminalOutputSanitizer';

describe('sanitizePersistedTerminalOutput', () => {
  it('keeps the latest readable redraw frame without raw ANSI control bytes', () => {
    const output = [
      '\u001b[2J\u001b[HWorking 1...\r\u001b[2KDone 1\n',
      '\u001b[2J\u001b[HWorking 2...\r\u001b[2KDone 2\n',
    ].join('');

    expect(sanitizePersistedTerminalOutput(output)).toBe('Done 2\n');
  });
});
