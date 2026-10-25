import { isCompiledExe } from '../exe.ts';
import { killTree } from '../run.ts';
import { asciiJson, forEachLine, spawnPowerShell } from './powershell.ts';

export interface TrayItem {
  id: string;
  label: string;
}

export interface Tray {
  /** False off Windows, where nothing shows. */
  supported: boolean;
  /** Resolves once the icon shows; rejects when the host ends or hangs before that. */
  ready: Promise<void>;
  /** Removes the icon and ends the host. */
  close(): Promise<void>;
}

const noopTray: Tray = { supported: false, ready: Promise.resolve(), close: async () => {} };

export interface TrayProcess {
  pid: number;
  end(): void;
  stdout: ReadableStream<Uint8Array>;
  stderr: ReadableStream<Uint8Array>;
  exited: Promise<number>;
}

export type TraySpawn = (script: string) => TrayProcess;

export interface TrayOptions {
  /** Hover text; Windows shows at most 63 characters. */
  tooltip: string;
  /** Menu entries in order; double-clicking the icon selects the first. */
  items: TrayItem[];
  /** File whose icon shows; default: the exe when compiled, else a generic application icon. */
  iconPath?: string;
  spawn?: TraySpawn;
  onSelect: (id: string) => void;
  onError?: (msg: string) => void;
  /** How long `ready` waits for the icon before the host is killed; default 15 s. */
  readyTimeoutMs?: number;
}

export interface TraySpec {
  tooltip: string;
  iconPath: string | null;
  /** `line` is what the host prints when the entry is clicked. */
  items: { label: string; line: string }[];
}

export function traySpec(opts: Pick<TrayOptions, 'tooltip' | 'items' | 'iconPath'>): TraySpec {
  return {
    tooltip: opts.tooltip.slice(0, 63),
    iconPath: opts.iconPath ?? null,
    // A single & marks a menu mnemonic.
    items: opts.items.map((item) => ({ label: item.label.replace(/&/g, '&&'), line: asciiJson({ select: item.id }) })),
  };
}

// The spec comes as base64 JSON, so labels need no escaping. [Console]::In.ReadLineAsync() blocks
// in .NET Framework, so stdin is read through its own StreamReader, polled by a timer next to the
// message loop; EOF (the parent quit or crashed) removes the icon and ends the host. A handler
// error must not reach WinForms, which would show its exception dialog.
const HOST_SCRIPT = `
$ErrorActionPreference = 'Stop'
$ProgressPreference = 'SilentlyContinue'
Add-Type -AssemblyName System.Windows.Forms, System.Drawing
$spec = [Text.Encoding]::UTF8.GetString([Convert]::FromBase64String('__SPEC__')) | ConvertFrom-Json
function Send($line) { try { [Console]::Out.WriteLine($line); [Console]::Out.Flush() } catch {} }
[System.Windows.Forms.Application]::add_ThreadException({ param($s, $e) try { [Console]::Error.WriteLine($e.Exception.Message) } catch {} })
$icon = New-Object System.Windows.Forms.NotifyIcon
$icon.Icon = [System.Drawing.SystemIcons]::Application
if ($spec.iconPath) {
  try { $icon.Icon = [System.Drawing.Icon]::ExtractAssociatedIcon($spec.iconPath) } catch { [Console]::Error.WriteLine($_.Exception.Message) }
}
$icon.Text = $spec.tooltip
$menu = New-Object System.Windows.Forms.ContextMenuStrip
foreach ($item in $spec.items) {
  $entry = $menu.Items.Add($item.label)
  $entry.Tag = $item.line
  $entry.add_Click({ param($s) Send $s.Tag })
}
$icon.ContextMenuStrip = $menu
$first = @($spec.items)[0]
$icon.add_MouseDoubleClick({ param($s, $e) if ($first -and $e.Button -eq 'Left') { Send $first.line } })
$stdin = New-Object System.IO.StreamReader([Console]::OpenStandardInput())
$state = @{ read = $stdin.ReadLineAsync() }
$timer = New-Object System.Windows.Forms.Timer
$timer.Interval = 250
$timer.add_Tick({
  if (-not $state.read.IsCompleted) { return }
  if (-not $state.read.IsFaulted -and $null -ne $state.read.Result) { $state.read = $stdin.ReadLineAsync(); return }
  $timer.Stop()
  [System.Windows.Forms.Application]::ExitThread()
})
$icon.Visible = $true
Send '{"ready":true}'
$timer.Start()
[System.Windows.Forms.Application]::Run()
$icon.Visible = $false
$icon.Dispose()
`;

function trayScript(spec: TraySpec): string {
  return HOST_SCRIPT.replace('__SPEC__', Buffer.from(JSON.stringify(spec), 'utf8').toString('base64'));
}

// -STA for WinForms; stdin is the parent's lifeline.
const spawnHost: TraySpawn = (script) => {
  const proc = spawnPowerShell(script, { sta: true, stdin: 'pipe', stdout: 'pipe' });
  return { pid: proc.pid, end: () => proc.stdin.end(), stdout: proc.stdout, stderr: proc.stderr, exited: proc.exited };
};

/**
 * A notification-area icon with a context menu, hosted by a PowerShell process. Off Windows
 * (without `spawn`) it returns a tray that does nothing.
 */
export function createTray(opts: TrayOptions): Tray {
  if (!opts.spawn && process.platform !== 'win32') return noopTray;
  const spawn = opts.spawn ?? spawnHost;
  const onError = opts.onError ?? ((msg) => console.warn(`tray: ${msg}`));
  const iconPath = opts.iconPath ?? (isCompiledExe() ? process.execPath : undefined);

  let resolveReady: () => void = () => {};
  let rejectReady: (err: Error) => void = () => {};
  const ready = new Promise<void>((resolve, reject) => {
    resolveReady = resolve;
    rejectReady = reject;
  });
  // The caller may not wait for it; a rejection must not end the process.
  ready.catch(() => {});

  let proc: TrayProcess;
  try {
    proc = spawn(trayScript(traySpec({ ...opts, iconPath })));
  } catch (err) {
    rejectReady(new Error(`tray host unavailable: ${(err as Error).message}`));
    return { supported: true, ready, close: async () => {} };
  }

  let shown = false;
  let closing: Promise<void> | null = null;
  const output = forEachLine(proc.stdout, (line) => {
    let msg: { ready?: unknown; select?: unknown } | null = null;
    try {
      msg = JSON.parse(line);
    } catch {
      // reported below
    }
    if (msg?.ready === true) {
      shown = true;
      resolveReady();
    } else if (typeof msg?.select === 'string') {
      try {
        opts.onSelect(msg.select);
      } catch (err) {
        onError(`menu entry ${msg.select} failed: ${(err as Error).message}`);
      }
    } else onError(`unexpected output: ${line}`);
  }).catch(() => {});
  const errors = forEachLine(proc.stderr, onError).catch(() => {});
  const done = Promise.all([proc.exited, output, errors]).then(([code]) => {
    if (!shown) rejectReady(new Error(`tray host exited with code ${code} before showing the icon`));
    else if (!closing) onError(`tray host exited with code ${code}`);
    return code;
  });

  const readyTimeoutMs = opts.readyTimeoutMs ?? 15_000;
  const readyTimer = setTimeout(() => {
    rejectReady(new Error(`tray icon didn't show within ${readyTimeoutMs / 1000} s`));
    killTree(proc.pid);
  }, readyTimeoutMs);
  const stopReadyTimer = () => clearTimeout(readyTimer);
  ready.then(stopReadyTimer, stopReadyTimer);

  return {
    supported: true,
    ready,
    close() {
      closing ??= (async () => {
        stopReadyTimer();
        try {
          proc.end();
        } catch {
          // already gone
        }
        let timer: ReturnType<typeof setTimeout> | undefined;
        const timeout = new Promise<null>((resolve) => {
          timer = setTimeout(resolve, 5000, null);
        });
        const code = await Promise.race([done, timeout]);
        clearTimeout(timer);
        if (code === null) killTree(proc.pid);
      })();
      return closing;
    },
  };
}

// `bun packages/platform/src/win/tray.ts --selftest`: shows the icon, then removes it; exit code 0
// means it showed within 15 s.
if (import.meta.main && process.argv.includes('--selftest')) {
  const tray = createTray({
    tooltip: 'Kedalion self-test',
    items: [{ id: 'hello', label: 'Self-test <&> "ção"' }],
    onSelect: (id) => console.log(`selected ${id}`),
    onError: (msg) => console.error(msg),
  });
  if (!tray.supported) {
    console.error('No tray on this platform.');
    process.exit(1);
  }
  let code = 0;
  try {
    await tray.ready;
  } catch (err) {
    console.error((err as Error).message);
    code = 1;
  }
  await tray.close();
  process.exit(code);
}
