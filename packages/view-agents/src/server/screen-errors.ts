export type ScreenErrorKind = 'auth' | 'rate' | 'overloaded' | 'api';

export interface ScreenError {
  kind: ScreenErrorKind;
  message: string;
}

export const SCREEN_ERROR_LINES = 25;

const RULES: { kind: ScreenErrorKind; re: RegExp }[] = [
  { kind: 'auth', re: /OAuth token has expired|Please run \/login|\b401\b.*(?:error|unauthorized|authentication)|(?:error|unauthorized|authentication).*\b401\b/i },
  { kind: 'rate', re: /\b429\b.*(?:error|rate|limit|too many)|(?:error|rate limit|too many).*\b429\b/i },
  { kind: 'overloaded', re: /overloaded/i },
  { kind: 'api', re: /API Error:?\s*\(?5\d\d\b|\b5\d\d\b.*(?:api error|internal server error|bad gateway|service unavailable|gateway timeout)|(?:api error|server error).*\b5\d\d\b/i },
];

/** The error shown in the last 25 lines of a Claude TUI screen (latest line wins), or null. */
export function detectScreenError(lines: string[]): ScreenError | null {
  const tail = lines.slice(-SCREEN_ERROR_LINES);
  for (let i = tail.length - 1; i >= 0; i--) {
    const line = tail[i]!.trim();
    if (!line) continue;
    for (const { kind, re } of RULES) if (re.test(line)) return { kind, message: line.slice(0, 200) };
  }
  return null;
}
