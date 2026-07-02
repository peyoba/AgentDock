const destructiveAnsiPattern =
  /\x1b\[\?(?:1049|1048|1047|1000|1002|1003|1005|1006|1015)[hl]|\x1b\[3J/g;
const oscPattern = /\x1b\][^\x07]*(?:\x07|\x1b\\)/g;

export function preserveTerminalHistoryOutput(data: string): string {
  return data.replace(oscPattern, '').replace(destructiveAnsiPattern, '');
}
