const screenRedrawBoundaryPattern =
  /\x1bc|\x1b\[\?(?:1049|1048|1047)[hl]|\x1b\[[0-3]?J|\x1b\[(?:\d{0,3}(?:;\d{0,3})*)?[Hf]/g;
const oscPattern = /\x1b\][^\x07]*(?:\x07|\x1b\\)/g;
const ansiEscapePattern =
  /\x1b(?:\[[0-?]*[ -/]*[@-~]|[PX^_][\s\S]*?\x1b\\|[@-Z\\-_])/g;
const nonTextControlPattern = /[\x00-\x08\x0B\x0C\x0E-\x1F\x7F]/g;

function latestRedrawFrame(data: string): string {
  let latestFrameStart = 0;
  for (const match of data.matchAll(screenRedrawBoundaryPattern)) {
    latestFrameStart = (match.index ?? 0) + match[0].length;
  }

  return latestFrameStart > 0 ? data.slice(latestFrameStart) : data;
}

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

export function sanitizePersistedTerminalOutput(data: string): string {
  if (!data) {
    return '';
  }

  return collapseCarriageReturnRedraws(
    latestRedrawFrame(data)
      .replace(oscPattern, '')
      .replace(ansiEscapePattern, '')
      .replace(nonTextControlPattern, ''),
  );
}
