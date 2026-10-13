export interface CurlCommand {
  from: number;
  to: number;
  text: string;
}

const START = /^\s*(?:\$\s+)?curl(?:\.exe)?(?=\s|$)/;

function scanQuote(line: string, open: string | null): string | null {
  let q = open;
  for (let i = 0; i < line.length; i++) {
    const c = line[i];
    if (q === "'") {
      if (c === "'") q = null;
    } else if (q === '"') {
      if (c === '\\' || c === '^') i++;
      else if (c === '"') q = null;
    } else if (c === '\\' || c === '^') {
      i++;
    } else if (c === "'" || c === '"') {
      q = c;
    }
  }
  return q;
}

export function curlCommands(text: string): CurlCommand[] {
  const out: CurlCommand[] = [];
  let start = -1;
  let end = 0;
  let quote: string | null = null;
  let continued = false;
  let pos = 0;
  while (pos <= text.length) {
    let nl = text.indexOf('\n', pos);
    if (nl < 0) nl = text.length;
    let lineEnd = nl;
    if (lineEnd > pos && text[lineEnd - 1] === '\r') lineEnd--;
    const line = text.slice(pos, lineEnd);
    const trimmed = line.trim();
    if (start >= 0 && !quote && !continued) {
      out.push({ from: start, to: end, text: text.slice(start, end) });
      start = -1;
    }
    if (start < 0) {
      if (trimmed !== '' && !trimmed.startsWith('#') && START.test(line)) {
        start = pos;
        quote = scanQuote(line, null);
        continued = !quote && /[\\^]$/.test(line.trimEnd());
        end = lineEnd;
      }
    } else {
      quote = scanQuote(line, quote);
      continued = !quote && /[\\^]$/.test(line.trimEnd());
      end = lineEnd;
    }
    pos = nl + 1;
  }
  if (start >= 0) out.push({ from: start, to: end, text: text.slice(start, end) });
  return out;
}

export function curlAt(text: string, offset: number): CurlCommand | null {
  let above: CurlCommand | null = null;
  for (const c of curlCommands(text)) {
    if (offset >= c.from && offset <= c.to) return c;
    if (c.to < offset) above = c;
  }
  return above;
}
