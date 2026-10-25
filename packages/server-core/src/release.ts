// Release file naming, shared by `kedalion build`.

/** Label of a platform in release file names: `win-x64`, `linux-arm64`, `mac-arm64`. */
export function platformLabel(os: string = process.platform, arch: string = process.arch): string {
  const name = os === 'win32' || os === 'windows' ? 'win' : os === 'darwin' ? 'mac' : os;
  return `${name}-${arch}`;
}
