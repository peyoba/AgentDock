export type StreamingTerminalTextSanitizer = {
  push(chunk: string): string;
  flush(): string;
  end(): string;
};

type ParserState =
  | 'text'
  | 'escape'
  | 'csi'
  | 'osc'
  | 'oscEscape'
  | 'controlString'
  | 'controlStringEscape';

function isCsiFinalCharacter(character: string): boolean {
  const characterCode = character.charCodeAt(0);
  return characterCode >= 0x40 && characterCode <= 0x7e;
}

function isScreenRedrawBoundary(csiSequence: string): boolean {
  return (
    /^[0-3]?J$/u.test(csiSequence) ||
    /^(?:\d{0,3}(?:;\d{0,3})*)?[Hf]$/u.test(csiSequence) ||
    /^\?(?:1047|1048|1049)[hl]$/u.test(csiSequence)
  );
}

function isDiscardedTextControl(character: string): boolean {
  const characterCode = character.charCodeAt(0);
  return (
    characterCode <= 0x08 ||
    characterCode === 0x0b ||
    characterCode === 0x0c ||
    (characterCode >= 0x0e && characterCode <= 0x1f) ||
    characterCode === 0x7f
  );
}

export function createStreamingTerminalTextSanitizer(): StreamingTerminalTextSanitizer {
  let parserState: ParserState = 'text';
  let pendingCarriageReturnText: string | undefined;
  let csiSequence = '';
  let streamEnded = false;

  const push = (chunk: string): string => {
    if (streamEnded || chunk.length === 0) {
      return '';
    }

    let readableText = '';
    let currentLineStart = 0;

    for (const character of chunk) {
      if (parserState === 'text' && pendingCarriageReturnText !== undefined) {
        const carriageReturnText = pendingCarriageReturnText;
        pendingCarriageReturnText = undefined;
        if (character === '\n') {
          readableText += `${carriageReturnText}\n`;
          currentLineStart = readableText.length;
          continue;
        }
        // A bare carriage return redraws the current line. Its previous text
        // remains pending only long enough to distinguish CRLF from overwrite.
      }

      switch (parserState) {
        case 'text':
          if (character === '\u001b') {
            parserState = 'escape';
          } else if (character === '\r') {
            pendingCarriageReturnText = readableText.slice(currentLineStart);
            readableText = readableText.slice(0, currentLineStart);
          } else if (!isDiscardedTextControl(character)) {
            readableText += character;
            if (character === '\n') {
              currentLineStart = readableText.length;
            }
          }
          break;
        case 'escape':
          if (character === '[') {
            parserState = 'csi';
            csiSequence = '';
          } else if (character === ']') {
            parserState = 'osc';
          } else if (character === 'P' || character === '^' || character === '_') {
            parserState = 'controlString';
          } else if (character === '\u001b') {
            parserState = 'escape';
          } else {
            // Two-character ESC sequences finish at their second character.
            parserState = 'text';
            if (character === 'c') {
              readableText = '';
              currentLineStart = 0;
            }
          }
          break;
        case 'csi':
          csiSequence += character;
          if (isCsiFinalCharacter(character)) {
            parserState = 'text';
            if (isScreenRedrawBoundary(csiSequence)) {
              readableText = '';
              currentLineStart = 0;
            }
            csiSequence = '';
          }
          break;
        case 'osc':
          if (character === '\u0007') {
            parserState = 'text';
          } else if (character === '\u001b') {
            parserState = 'oscEscape';
          }
          break;
        case 'oscEscape':
          if (character === '\\') {
            parserState = 'text';
          } else if (character !== '\u001b') {
            parserState = 'osc';
          }
          break;
        case 'controlString':
          if (character === '\u001b') {
            parserState = 'controlStringEscape';
          }
          break;
        case 'controlStringEscape':
          if (character === '\\') {
            parserState = 'text';
          } else if (character !== '\u001b') {
            parserState = 'controlString';
          }
          break;
      }
    }

    return readableText;
  };

  return {
    push,
    flush(): string {
      return '';
    },
    end(): string {
      streamEnded = true;
      parserState = 'text';
      csiSequence = '';
      const remainingText = pendingCarriageReturnText ?? '';
      pendingCarriageReturnText = undefined;
      return remainingText;
    },
  };
}
