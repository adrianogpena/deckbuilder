/** A file read from a dropped folder; `rel` is its path below the dropped entry's parent, starting with the entry's own name. */
export interface DroppedFile {
  rel: string[];
  file: File;
}

/** What a dropped OS entry holds: every file below it, and the folders that have nothing in them. */
export interface DroppedTree {
  files: DroppedFile[];
  emptyDirs: string[][];
}

/** The entries of a drop; call before the first await, the browser empties `items` afterwards. */
export function entriesOf(data: DataTransfer): FileSystemEntry[] {
  const entries: FileSystemEntry[] = [];
  for (const item of Array.from(data.items)) {
    const entry = item.kind === 'file' ? item.webkitGetAsEntry() : null;
    if (entry) entries.push(entry);
  }
  return entries;
}

const readFile = (entry: FileSystemFileEntry) => new Promise<File>((resolve, reject) => entry.file(resolve, reject));

async function readAll(dir: FileSystemDirectoryEntry): Promise<FileSystemEntry[]> {
  const reader = dir.createReader();
  const all: FileSystemEntry[] = [];
  for (;;) {
    const batch = await new Promise<FileSystemEntry[]>((resolve, reject) => reader.readEntries(resolve, reject));
    if (!batch.length) return all;
    all.push(...batch);
  }
}

/** Walks `entry` (a file or a folder, recursively). */
export async function walkEntry(entry: FileSystemEntry, parent: string[] = [], out: DroppedTree = { files: [], emptyDirs: [] }): Promise<DroppedTree> {
  const rel = [...parent, entry.name];
  if (entry.isFile) {
    out.files.push({ rel, file: await readFile(entry as FileSystemFileEntry) });
  } else {
    const children = await readAll(entry as FileSystemDirectoryEntry);
    if (!children.length) out.emptyDirs.push(rel);
    for (const child of children) await walkEntry(child, rel, out);
  }
  return out;
}

/** `wanted`, or the first free `name copy.ext`, `name copy 2.ext`, ... among `taken` (compared with `fold`). Like the server's copy naming. */
export function freeName(wanted: string, isDir: boolean, taken: ReadonlySet<string>, fold: (name: string) => string = (n) => n): string {
  const dot = wanted.lastIndexOf('.');
  const ext = isDir || dot <= 0 ? '' : wanted.slice(dot);
  const stem = ext ? wanted.slice(0, dot) : wanted;
  let name = wanted;
  for (let n = 1; taken.has(fold(name)); n++) name = `${stem} copy${n > 1 ? ` ${n}` : ''}${ext}`;
  return name;
}
