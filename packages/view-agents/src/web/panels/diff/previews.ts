/** Preview diff tabs that are still unpinned, so the next preview can replace them (the workspace has no preview flag of its own). */
const open = new Map<string, string>();

export const registerPreview = (tabId: string, project: string) => void open.set(tabId, project);
export const unregisterPreview = (tabId: string) => void open.delete(tabId);

/** Tab ids of the unpinned preview diffs of `project`. */
export const previewsOf = (project: string): string[] => [...open].filter(([, p]) => p === project).map(([id]) => id);
