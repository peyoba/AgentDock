const oscPattern = /\x1b\][^\x07]*(?:\x07|\x1b\\)/g;
const ansiEscapePattern =
  /\x1b(?:\[[0-?]*[ -/]*[@-~]|[PX^_][\s\S]*?\x1b\\|[@-Z\\-_])/g;
const nonTextControlPattern = /[\x00-\x08\x0B\x0C\x0E-\x1F\x7F]/g;
const transientStatusLinePattern = /^\s*(?:Working|Thinking)\([^)]*esc to interrupt[^)]*\)\s*$/i;
const boxDrawingOnlyPattern = /^\s*[┌┐└┘─│├┤┬┴┼╭╮╰╯━┃]+\s*$/;
const terminalCharacterSetArtifactPattern = /^\s*\(B\s*$/;
const codexStartupHeadingPattern = /^\s*>_\s+OpenAI Codex\b/i;
const codexStartupFieldPattern = /^\s*(?:model|directory|permissions):\s+/i;
const codexTipPattern = /^\s*Tip:\s+Our most capable model yet\./i;
const restoreInstructionStartPattern =
  /^\s*[›>]\s*Read the AgentDock restore context file and use it as background memory\./i;
const restoreInstructionContinuationPattern =
  /(?:memory-restored sentence|wait for the user's next instruction|Do not continue previous tasks|\.agentdock\/context\/restores\/session-[^\s]+\.md)/i;
const hookTrustWarningPattern = /dangerously-bypass-hook-trust.*enabled hooks may run without review/i;
const modelMetadataWarningPattern =
  /Model metadata for .* not found\. Defaulting to fallback metadata/i;
const modelMetadataWarningContinuationPattern = /^\s*degrade performance and cause issues\.\s*$/i;
const restoreExploredHeadingPattern = /^\s*[•*]\s*Explored\s*$/i;
const restoreFileReadPattern = /^\s*[└├│]?\s*Read\s+session-[A-Za-z0-9._:-]+\.md\s*$/i;
const agentDockProcessMarkerPattern = /^\s*\[AgentDock]\s+进程已退出（exit code [^)]+），会话已结束.*$/;
const grokShortcutChromePattern =
  /Ctrl\+x:shortcuts|Space:prompt|Ctrl\+o:always-approve|Ctrl\+c:cancel\d{4,}/i;
const mostlyBoxDrawingPattern = /^[\s┌┐└┘─│├┤┬┴┼╭╮╰╯━┃═║╔╗╚╝╠╣╦╩╬▀▄█▌▐░▒▓╱╲╳]+$/;
const boxDrawingCharPattern = /[┌┐└┘─│├┤┬┴┼╭╮╰╯━┃═║╔╗╚╝╠╣╦╩╬]/g;

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

function collapseBlankLines(lines: string[]): string[] {
  const collapsedLines: string[] = [];
  for (const line of lines) {
    if (!line.trim() && !collapsedLines.at(-1)?.trim()) {
      continue;
    }
    collapsedLines.push(line.replace(/[ \t]+$/g, ''));
  }

  while (collapsedLines.length > 0 && !collapsedLines[0].trim()) {
    collapsedLines.shift();
  }
  while (collapsedLines.length > 0 && !collapsedLines.at(-1)?.trim()) {
    collapsedLines.pop();
  }
  return collapsedLines;
}


function isMostlyBoxDrawingLine(line: string): boolean {
  const trimmed = line.trim();
  if (!trimmed) {
    return false;
  }
  if (mostlyBoxDrawingPattern.test(trimmed) || boxDrawingOnlyPattern.test(line)) {
    return true;
  }
  const boxCount = (trimmed.match(boxDrawingCharPattern) ?? []).length;
  return boxCount >= 8 && boxCount / trimmed.length >= 0.45;
}

function isGrokUiChromeLine(line: string): boolean {
  const trimmed = line.trim();
  if (!trimmed) {
    return false;
  }
  if (grokShortcutChromePattern.test(trimmed)) {
    return true;
  }
  if (isMostlyBoxDrawingLine(trimmed)) {
    return true;
  }
  // Fragmented redraw rows often mix box edges with sparse text.
  const boxCount = (trimmed.match(boxDrawingCharPattern) ?? []).length;
  if (boxCount >= 6 && trimmed.length > 40) {
    const textish = trimmed.replace(boxDrawingCharPattern, '').replace(/\s+/g, '');
    if (textish.length > 0 && textish.length / trimmed.length < 0.35) {
      return true;
    }
  }
  return false;
}

/**
 * Produces the user-facing transcript for exited sessions without modifying the
 * raw persisted terminal history used for recovery and diagnostics.
 */
export function readableSessionHistory(data: string): string {
  const plainTextLines = terminalOutputToPlainText(data).split('\n');
  const readableLines: string[] = [];
  let skippingCodexTip = false;
  let skippingRestoreInstruction = false;
  let pendingRestoreExploredHeading: string | undefined;

  for (const line of plainTextLines) {
    const trimmedLine = line.trim();

    if (skippingCodexTip) {
      if (!trimmedLine) {
        skippingCodexTip = false;
      }
      continue;
    }

    if (skippingRestoreInstruction) {
      if (!trimmedLine) {
        skippingRestoreInstruction = false;
      } else if (restoreInstructionContinuationPattern.test(line)) {
        continue;
      } else {
        skippingRestoreInstruction = false;
      }
    }

    if (pendingRestoreExploredHeading !== undefined) {
      if (restoreFileReadPattern.test(line)) {
        pendingRestoreExploredHeading = undefined;
        continue;
      }
      readableLines.push(pendingRestoreExploredHeading);
      pendingRestoreExploredHeading = undefined;
    }

    if (
      boxDrawingOnlyPattern.test(line) ||
      isGrokUiChromeLine(line) ||
      terminalCharacterSetArtifactPattern.test(line) ||
      codexStartupHeadingPattern.test(line) ||
      codexStartupFieldPattern.test(line) ||
      hookTrustWarningPattern.test(line) ||
      modelMetadataWarningPattern.test(line) ||
      modelMetadataWarningContinuationPattern.test(line) ||
      agentDockProcessMarkerPattern.test(line)
    ) {
      continue;
    }

    if (codexTipPattern.test(line)) {
      skippingCodexTip = true;
      continue;
    }

    if (restoreInstructionStartPattern.test(line)) {
      skippingRestoreInstruction = true;
      continue;
    }

    if (restoreExploredHeadingPattern.test(line)) {
      pendingRestoreExploredHeading = line;
      continue;
    }

    readableLines.push(line);
  }

  if (pendingRestoreExploredHeading !== undefined) {
    readableLines.push(pendingRestoreExploredHeading);
  }

  return collapseBlankLines(readableLines).join('\n');
}
