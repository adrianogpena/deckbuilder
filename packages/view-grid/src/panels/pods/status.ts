export type Tone = 'ok' | 'warn' | 'err' | 'info' | 'muted';

const ERROR_REASONS = /CrashLoopBackOff|Error|ErrImagePull|ImagePullBackOff|InvalidImageName|OOMKilled|CreateContainer(Config)?Error|Failed|Evicted|ContainerStatusUnknown|DeadlineExceeded|BackoffLimitExceeded/i;

export function readyCount(pod: any): [number, number] {
  const cs: any[] = pod?.status?.containerStatuses ?? [];
  const total = pod?.spec?.containers?.length ?? cs.length;
  return [cs.filter((c) => c.ready).length, total];
}

export function restarts(pod: any): number {
  return (pod?.status?.containerStatuses ?? []).reduce((n: number, c: any) => n + (c.restartCount ?? 0), 0);
}

export function podStatus(pod: any): { text: string; tone: Tone } {
  const st = pod?.status ?? {};
  let reason: string = st.reason || st.phase || 'Unknown';
  let initializing = false;

  const inits: any[] = st.initContainerStatuses ?? [];
  inits.forEach((c, i) => {
    if (initializing) return;
    const t = c.state?.terminated;
    const w = c.state?.waiting;
    if (t && t.exitCode === 0) return;
    if (t) reason = `Init:${t.reason || (t.signal ? `Signal:${t.signal}` : `ExitCode:${t.exitCode}`)}`;
    else if (w?.reason && w.reason !== 'PodInitializing') reason = `Init:${w.reason}`;
    else reason = `Init:${i}/${inits.length}`;
    initializing = true;
  });

  if (!initializing) {
    let hasRunning = false;
    for (const c of [...(st.containerStatuses ?? [])].reverse()) {
      const w = c.state?.waiting;
      const t = c.state?.terminated;
      if (w?.reason) reason = w.reason;
      else if (t?.reason) reason = t.reason;
      else if (t) reason = t.signal ? `Signal:${t.signal}` : `ExitCode:${t.exitCode}`;
      else if (c.ready && c.state?.running) hasRunning = true;
    }
    if (reason === 'Completed' && hasRunning) reason = 'Running';
  }

  if (pod?.metadata?.deletionTimestamp) reason = st.reason === 'NodeLost' ? 'Unknown' : 'Terminating';

  let tone: Tone = 'info';
  if (ERROR_REASONS.test(reason)) tone = 'err';
  else if (reason === 'Running') {
    const [r, t] = readyCount(pod);
    tone = r === t ? 'ok' : 'warn';
  } else if (reason === 'Succeeded' || reason === 'Completed') tone = 'muted';
  else if (reason === 'Terminating' || reason.startsWith('Init:') || reason === 'Pending' || reason === 'ContainerCreating') tone = 'warn';
  return { text: reason, tone };
}

/** ok when all ready, err when none, warn otherwise. */
export function readyTone(ready: number, total: number): Tone {
  if (ready >= total) return 'ok';
  if (ready === 0) return 'err';
  return 'warn';
}

export function restartsTone(n: number): Tone {
  if (n > 5) return 'err';
  if (n > 0) return 'warn';
  return 'muted';
}

/** Badge of one container: running+ready ok, running not ready warn, waiting warn, terminated exit 0 muted, else err. */
export function containerState(c: any): { text: string; tone: Tone } {
  const s = c?.state ?? {};
  if (s.running) return { text: 'Running', tone: c.ready ? 'ok' : 'warn' };
  if (s.waiting) return { text: s.waiting.reason || 'Waiting', tone: 'warn' };
  if (s.terminated) {
    const t = s.terminated;
    return { text: t.reason || (t.signal ? `Signal:${t.signal}` : `ExitCode:${t.exitCode}`), tone: t.exitCode === 0 ? 'muted' : 'err' };
  }
  return { text: 'Unknown', tone: 'err' };
}
