// Not hidden: windowsHide starts explorer.exe with SW_HIDE and its window never appears.
export function launch(argv: string[], windowsVerbatimArguments = false): void {
  Bun.spawn(argv, { stdio: ['ignore', 'ignore', 'ignore'], windowsHide: false, windowsVerbatimArguments }).unref();
}
