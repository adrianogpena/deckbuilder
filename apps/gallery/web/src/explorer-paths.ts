/** Relative paths of a project, always with `/` and no leading slash; '' is the project folder. */

export const joinPath = (dir: string, name: string) => (dir ? `${dir}/${name}` : name);

export const dirname = (path: string) => path.slice(0, Math.max(0, path.lastIndexOf('/')));

export const basename = (path: string) => path.slice(path.lastIndexOf('/') + 1);

/** `path` is `prefix` or lies inside it. */
export const isUnder = (path: string, prefix: string) => path === prefix || path.startsWith(`${prefix}/`);

/** Where `path` ends up when `from` is renamed or moved to `to`; unchanged when it isn't inside `from`. */
export const movedPath = (path: string, from: string, to: string) => (isUnder(path, from) ? to + path.slice(from.length) : path);

/** Tree node id, also what `settings.explorer.expanded` stores. */
export const nodeId = (project: string, path: string) => `${project}:${path}`;
