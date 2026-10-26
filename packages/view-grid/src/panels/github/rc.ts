export const RC_MARKER = '01a1622b-edac-77da-9486-947c5752d977';
export const RC_STEPS = ['maven', 'native', 'scratch', 'jvm', 'jvmJlink', 'dbScripts', 'angular'] as const;
export type RcStepState = 'ok' | 'fail' | 'none';

export interface RcBuild {
  date: string;
  version: string | null;
  failed: boolean;
  steps: Record<string, RcStepState>;
  npmUrl?: string;
}
export interface RcModule {
  name: string;
  builds: RcBuild[];
}
export interface RcInfo {
  modules: RcModule[];
  warnings: string[];
}

const stepState = (cell: string): RcStepState => (cell.includes('✅') ? 'ok' : cell.includes('❌') ? 'fail' : 'none');

function cells(line: string): string[] {
  const t = line.trim().replace(/^\|/, '').replace(/\|$/, '');
  return t.split('|').map((c) => c.trim());
}

function parseRow(line: string): RcBuild | null {
  const c = cells(line);
  if (c.length < 9) return null;
  const date = c[0] ?? '';
  if (!date || /^-+$/.test(date.replace(/[:\s]/g, '')) || /^build date$/i.test(date)) return null;
  const raw = (c[1] ?? '').replace(/`/g, '').trim();
  const failed = /failed/i.test(raw) || !raw;
  const steps: Record<string, RcStepState> = {};
  RC_STEPS.forEach((s, i) => {
    steps[s] = stepState(c[2 + i] ?? '');
  });
  const link = /\]\((https?:[^)\s]+)\)/.exec(c[8] ?? '');
  return { date, version: failed ? null : raw, failed, steps, ...(link?.[1] ? { npmUrl: link[1] } : {}) };
}

export function isRcComment(body: string): boolean {
  return body.includes(`<!-- ${RC_MARKER} -->`);
}

export function parseRcComment(body: string): RcInfo {
  const modules: RcModule[] = [];
  const warnings: string[] = [];
  let current: RcModule | null = null;
  let warn: string[] | null = null;
  for (const line of body.split(/\r?\n/)) {
    const l = line.trim();
    if (/^>\s*\[!WARNING\]/i.test(l)) {
      warn = [];
      continue;
    }
    if (warn) {
      if (l.startsWith('>')) {
        const text = l.replace(/^>\s?/, '').trim();
        if (text) warn.push(text);
        continue;
      }
      warnings.push(...warn);
      warn = null;
    }
    const h = /^###\s+(.+)$/.exec(l);
    if (h?.[1]) {
      current = { name: h[1].trim(), builds: [] };
      modules.push(current);
      continue;
    }
    if (current && l.startsWith('|')) {
      const build = parseRow(l);
      if (build) current.builds.push(build);
    }
  }
  if (warn) warnings.push(...warn);
  return { modules, warnings };
}

export interface LatestRc {
  latest: RcBuild | null;
  lastGood: string | null;
}

export function latestRc(modules: readonly RcModule[]): LatestRc {
  const builds = modules.flatMap((m) => m.builds);
  const latest = builds.length ? (modules.length === 1 ? builds[builds.length - 1] ?? null : latestAcross(modules)) : null;
  const good = [...(modules.find((m) => m.builds.includes(latest as RcBuild))?.builds ?? builds)].reverse().find((b) => b.version && !b.failed);
  return { latest, lastGood: good?.version ?? null };
}

function latestAcross(modules: readonly RcModule[]): RcBuild | null {
  let best: RcBuild | null = null;
  let bestTime = -Infinity;
  for (const m of modules) {
    const last = m.builds[m.builds.length - 1];
    if (!last) continue;
    const t = Date.parse(last.date);
    if (!best || (!Number.isNaN(t) && t >= bestTime)) {
      best = last;
      bestTime = Number.isNaN(t) ? bestTime : t;
    }
  }
  return best;
}
