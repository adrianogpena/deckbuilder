/** Index of the section being read: the last heading whose top (relative to the container's top) is at or above `offset`; the last heading when scrolled to the bottom, 0 before the first one. */
export function activeHeading(tops: readonly number[], offset: number, atBottom: boolean): number {
  if (tops.length === 0) return -1;
  if (atBottom) return tops.length - 1;
  let active = 0;
  for (let i = 0; i < tops.length; i++) {
    if (tops[i]! <= offset) active = i;
    else break;
  }
  return active;
}
