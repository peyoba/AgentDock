const oscPattern = /\x1b\][^\x07]*(?:\x07|\x1b\\)/g;
const ansiEscapePattern =
  /\x1b(?:\[[0-?]*[ -/]*[@-~]|[PX^_][\s\S]*?\x1b\\|[@-Z\\-_])/g;
const nonTextControlPattern = /[\x00-\x08\x0B\x0C\x0E-\x1F\x7F]/g;
const transientStatusLinePattern = /^\s*(?:Working|Thinking)\([^)]*esc to interrupt[^)]*\)\s*$/i;

function collapseCarriageReturnRedraws(data: string): string {
  return data
    .replace(/\r\n/g, '\n')
    .split('\n')
    .map((line) => {
      const frames = line.split('\r');
      return frames[frames.length - 1] ?? '';
    })
    .join('\n');
}

export function terminalOutputToPlainText(data: string): string {
  if (!data) {
    return '';
  }

  return collapseCarriageReturnRedraws(data)
    .replace(oscPattern, '')
    .replace(ansiEscapePattern, '')
    .replace(nonTextControlPattern, '')
    .split('\n')
    .filter((line) => !transientStatusLinePattern.test(line))
    .join('\n');
}
