let multiDelete = false;

/** Set by `explorerView`: whether the tree may delete several entries at once. */
export const setMultiDelete = (enabled: boolean) => {
  multiDelete = enabled;
};

export const multiDeleteEnabled = () => multiDelete;
