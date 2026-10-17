import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

export interface NotesStore {
  read(projectId: string): string;
  /** False when the project id is not a usable file name or the write failed. */
  write(projectId: string, text: string): boolean;
}

const SAFE_ID = /^[\w.-]+$/;

/** Per-project markdown notes kept in `<dir>/<projectId>.md`; ids that could leave `dir` are refused. */
export function createNotesStore(dir: string): NotesStore {
  const fileOf = (id: string) => (SAFE_ID.test(id) && id !== '.' && id !== '..' ? join(dir, `${id}.md`) : undefined);
  return {
    read(id) {
      const file = fileOf(id);
      if (!file) return '';
      try {
        return readFileSync(file, 'utf8');
      } catch {
        return '';
      }
    },
    write(id, text) {
      const file = fileOf(id);
      if (!file) return false;
      try {
        mkdirSync(dir, { recursive: true });
        writeFileSync(file, text);
        return true;
      } catch {
        return false;
      }
    },
  };
}
