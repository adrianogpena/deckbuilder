const IDENTIFIER = /^[A-Za-z_$][A-Za-z0-9_$]*$/;

/** A JSONPath for the segments: `$.a[2]["b c"]`. */
export function pathOf(segments: Array<string | number>): string {
  let path = '$';
  for (const s of segments) {
    if (typeof s === 'number') path += `[${s}]`;
    else if (IDENTIFIER.test(s)) path += `.${s}`;
    else path += `[${JSON.stringify(s)}]`;
  }
  return path;
}
