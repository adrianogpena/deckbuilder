/** Tree node id, also what `settings.explorer.expanded` stores. */
export const nodeId = (project: string, path: string) => `${project}:${path}`;

/** Absolute path of `path` inside the project folder, with the separator the folder path uses. */
export function fullPath(projectPath: string, path: string): string {
  if (!path) return projectPath;
  const sep = projectPath.includes('\\') ? '\\' : '/';
  return `${projectPath.replace(/[\\/]+$/, '')}${sep}${path.split('/').join(sep)}`;
}
