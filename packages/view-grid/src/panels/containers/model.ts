export interface Container {
  name: string;
  image: string;
  state: string;
  status: string;
  /** Epoch milliseconds, 0 when unknown. */
  created: number;
  pinned?: boolean;
}

const str = (v: unknown): string => (typeof v === 'string' ? v : '');

function fromAny(r: Record<string, unknown>, id: string, names: string, created: number): Container {
  return { name: names || id.slice(0, 12), image: str(r.Image), state: str(r.State), status: str(r.Status), created };
}

/** `podman ps -a --format json`: one JSON array. Invalid output gives an empty list. */
export function parsePodman(stdout: string): Container[] {
  let data: unknown;
  try {
    data = JSON.parse(stdout);
  } catch {
    return [];
  }
  if (!Array.isArray(data)) return [];
  return data
    .filter((r): r is Record<string, unknown> => !!r && typeof r === 'object')
    .map((r) => {
      const names = Array.isArray(r.Names) ? str(r.Names[0]) : str(r.Names);
      const created = typeof r.Created === 'number' ? r.Created * 1000 : 0;
      return fromAny(r, str(r.Id), names, created);
    });
}

/** `docker ps -a --format "{{json .}}"`: one JSON object per line. */
export function parseDocker(stdout: string): Container[] {
  const out: Container[] = [];
  for (const line of stdout.split(/\r?\n/)) {
    if (!line.trim()) continue;
    let r: Record<string, unknown>;
    try {
      r = JSON.parse(line) as Record<string, unknown>;
    } catch {
      continue;
    }
    if (!r || typeof r !== 'object') continue;
    const ms = Date.parse(str(r.CreatedAt).replace(/ [A-Z]{3,4}$/, '').replace(' ', 'T').replace(/ ([+-]\d{4})/, '$1'));
    const names = str(r.Names).split(',')[0] ?? '';
    out.push(fromAny(r, str(r.ID), names, Number.isFinite(ms) ? ms : 0));
  }
  return out;
}

export const isMachineDown = (stderr: string): boolean => /cannot connect to podman|unable to connect to podman socket/i.test(stderr);

export const parsePinned = (text: string): string[] => text.split(/\r?\n/).map((s) => s.trim()).filter(Boolean);

/** Pinned names first (in pinned order), then the rest by name. */
export function sortPinned(list: Container[], pinned: string[]): Container[] {
  const rank = (c: Container) => {
    const i = pinned.indexOf(c.name);
    return i < 0 ? Infinity : i;
  };
  return list
    .map((c) => ({ ...c, pinned: rank(c) !== Infinity }))
    .sort((a, b) => rank(a) - rank(b) || a.name.localeCompare(b.name));
}
