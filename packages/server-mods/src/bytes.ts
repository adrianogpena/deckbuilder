/** True when the first 8 KiB holds a NUL byte, which text files don't. */
export const isBinary = (bytes: Uint8Array) => bytes.subarray(0, 8192).includes(0);
