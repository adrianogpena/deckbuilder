/** A file another screen wants the Explorer to show: revealed in the tree, and opened when `open`. */
export interface ExplorerRequest {
  project: string;
  path: string;
  open: boolean;
}

let pending: ExplorerRequest | undefined;

/** Set before `go('explorer')`; the Explorer takes it once its projects have loaded. */
export const requestExplorer = (request: ExplorerRequest) => {
  pending = request;
};

export const takeExplorerRequest = (): ExplorerRequest | undefined => {
  const request = pending;
  pending = undefined;
  return request;
};
