import { terminalOutputToPlainText } from '../shared/terminalText';

const rawTerminalColorReplyPattern =
  /\x1b\](?:4;\d+|1[012]);rgb:[0-9a-fA-F]{1,4}\/[0-9a-fA-F]{1,4}\/[0-9a-fA-F]{1,4}(?:\x07|\x1b\\)/g;
const echoedTerminalColorReplyPattern =
  /\^\[\](?:4;\d+|1[012]);rgb:[0-9a-fA-F]{1,4}\/[0-9a-fA-F]{1,4}\/[0-9a-fA-F]{1,4}(?:\^G|\^\[\\)/g;

export function preserveTerminalHistoryOutput(data: string): string {
  return terminalOutputToPlainText(data);
}

export function preserveLiveAgentOutput(data: string): string {
  return data
    .replace(rawTerminalColorReplyPattern, '')
    .replace(echoedTerminalColorReplyPattern, '');
}
