import { stat } from 'node:fs/promises';
import { join } from 'node:path';
import {
  EDITOR_NAMES,
  type EditorId,
  findEditor,
  openInEditor,
  pickFile,
  readJsonFile,
  writeJsonAtomic,
} from '@deckbuilderkit/platform';
import { type EditorInfo, invalid, isRecord, type Routes } from '@deckbuilderkit/server-core';
import { fromPlatform } from './platform-errors.ts';
import type { RootedFs } from './rooted-fs.ts';

export type { EditorInfo };

export interface EditorRoutesOptions {
  /** Folder of editors.json (the overrides), usually `appHome(APP.id)`. */
  dir: string;
  fs: RootedFs;
  pick?: typeof pickFile;
  find?: typeof findEditor;
  open?: typeof openInEditor;
}

type Overrides = Partial<Record<EditorId, string>>;

const badRequest = () => invalid('badRequest', 'Invalid request.');
const badEditor = () => invalid('badEditor', 'Unknown editor.');
const isEditor = (v: unknown): v is EditorId => typeof v === 'string' && Object.hasOwn(EDITOR_NAMES, v);
const editorOf = (v: unknown): EditorId => {
  if (!isEditor(v)) throw badEditor();
  return v;
};

/**
 * `GET /api/editors`, `POST /api/editors/pick`, `DELETE /api/editors/override?editor=` and
 * `POST /api/editors/open`. The program to run comes from detection or from a server-side file
 * dialog saved in `<dir>/editors.json`, never from the client; `.cmd` scripts are refused because
 * they would go through cmd.exe.
 */
export function editorRoutes(opts: EditorRoutesOptions): Routes {
  const { dir, fs, pick = pickFile, find = findEditor, open = openInEditor } = opts;
  const file = join(dir, 'editors.json');

  const readOverrides = async (): Promise<Overrides> => {
    const stored = (await readJsonFile(file, isRecord)) as Record<string, unknown> | undefined;
    const overrides: Overrides = {};
    for (const id of Object.keys(EDITOR_NAMES) as EditorId[]) {
      const value = stored?.[id];
      if (typeof value === 'string' && value !== '') overrides[id] = value;
    }
    return overrides;
  };

  const list = async (): Promise<EditorInfo[]> => {
    const overrides = await readOverrides();
    return Promise.all(
      (Object.keys(EDITOR_NAMES) as EditorId[]).map(async (id) => {
        const custom = overrides[id] !== undefined;
        return { id, name: EDITOR_NAMES[id], path: overrides[id] ?? (await find(id)), custom };
      }),
    );
  };

  return {
    'GET /api/editors': () => list(),

    'POST /api/editors/pick': async ({ json }) => {
      const editor = editorOf(((await json()) as Record<string, unknown>).editor);
      const picked = await pick({
        title: `Choose the ${EDITOR_NAMES[editor]} program`,
        filters: [{ name: 'Programs', patterns: ['*.exe'] }],
      }).catch(fromPlatform);
      if (picked === null) return list();
      if (process.platform === 'win32' && !/\.exe$/i.test(picked)) throw invalid('editorNotExe', 'The editor program must be an existing .exe file.');
      await writeJsonAtomic(file, { ...(await readOverrides()), [editor]: picked });
      return list();
    },

    'DELETE /api/editors/override': async ({ query }) => {
      const editor = editorOf(query.get('editor'));
      const { [editor]: _removed, ...rest } = await readOverrides();
      await writeJsonAtomic(file, rest);
      return list();
    },

    'POST /api/editors/open': async ({ json }) => {
      const b = (await json()) as Record<string, unknown>;
      const editor = editorOf(b.editor);
      if (typeof b.root !== 'string' || (b.path !== undefined && typeof b.path !== 'string')) throw badRequest();
      const line = b.line;
      if (line !== undefined && (typeof line !== 'number' || !Number.isInteger(line) || line < 1)) throw badRequest();

      const folder = (await fs.resolve(b.root, '', { mustExist: true })).real;
      let target: string | undefined;
      if (typeof b.path === 'string' && b.path !== '') {
        const real = (await fs.resolve(b.root, b.path, { mustExist: true })).real;
        if (!(await stat(real)).isDirectory()) target = real;
      }

      const exe = (await readOverrides())[editor] ?? (await find(editor));
      if (!exe) throw invalid('editorNotFound', 'The editor was not found. Choose its program in Settings.');
      await open(editor, exe, { folder, file: target, line: target ? line : undefined }).catch(fromPlatform);
      return { ok: true };
    },
  };
}
