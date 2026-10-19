/** The folder of the project a session belongs to: its added project's path, else its own cwd. */
export function projectPathOf(session: { project?: string; cwd: string }, projects: Array<{ id: string; path: string }>): string {
  return (session.project ? projects.find((p) => p.id === session.project)?.path : undefined) ?? session.cwd;
}

/** Same folder, whatever the slash style, trailing slash or case. */
export const sameFolder = (a: string, b: string): boolean => {
  const key = (p: string) => p.replaceAll('\\', '/').replace(/\/+$/, '').toLowerCase();
  return key(a) === key(b);
};
