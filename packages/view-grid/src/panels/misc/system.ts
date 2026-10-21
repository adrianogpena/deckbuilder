import { statfs } from 'node:fs/promises';
import os from 'node:os';

export interface SystemStats {
  /** CPU use in percent (0-100). */
  cpu: number;
  memory: { usedBytes: number; totalBytes: number };
  disk: { freeBytes: number; totalBytes: number } | null;
  uptimeSec: number;
}

const cpuTimes = (): { idle: number; total: number } => {
  let idle = 0;
  let total = 0;
  for (const c of os.cpus()) {
    idle += c.times.idle;
    total += c.times.user + c.times.nice + c.times.sys + c.times.idle + c.times.irq;
  }
  return { idle, total };
};

/** CPU % from two samples `intervalMs` apart (Windows has no load average). */
export async function cpuPercent(intervalMs = 200): Promise<number> {
  const a = cpuTimes();
  await new Promise((r) => setTimeout(r, intervalMs));
  const b = cpuTimes();
  const total = b.total - a.total;
  if (total <= 0) return 0;
  return Math.min(100, Math.max(0, Math.round((1 - (b.idle - a.idle) / total) * 100)));
}

export async function systemStats(dataDir: string): Promise<SystemStats> {
  const [cpu, disk] = await Promise.all([
    cpuPercent(),
    statfs(dataDir || '.').then(
      (s) => ({ freeBytes: Number(s.bavail) * Number(s.bsize), totalBytes: Number(s.blocks) * Number(s.bsize) }),
      () => null,
    ),
  ]);
  const totalBytes = os.totalmem();
  return { cpu, memory: { usedBytes: totalBytes - os.freemem(), totalBytes }, disk, uptimeSec: Math.round(os.uptime()) };
}
