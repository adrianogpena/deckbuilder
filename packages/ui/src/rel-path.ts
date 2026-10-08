/** Helpers for `/`-separated relative paths without a leading slash; '' is the root. */
export const relPath = {
  join: (dir: string, name: string) => (dir ? `${dir}/${name}` : name),

  dirname: (path: string) => path.slice(0, Math.max(0, path.lastIndexOf('/'))),

  basename: (path: string) => path.slice(path.lastIndexOf('/') + 1),

  /** `path` is `prefix` or lies inside it; everything is under the root ''. */
  isUnder: (path: string, prefix: string) => prefix === '' || path === prefix || path.startsWith(`${prefix}/`),

  /** Where `path` ends up when `from` is renamed or moved to `to`; unchanged when it isn't inside `from`. */
  moved: (path: string, from: string, to: string) => (relPath.isUnder(path, from) ? to + path.slice(from.length) : path),
};
