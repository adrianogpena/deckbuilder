import { stat } from 'node:fs/promises';
import { join } from 'node:path';
import {
  EDITOR_NAMES,
  type EditorId,
  findEditor,
  openInEditor,
  readJsonFile,
  writeJsonAtomic,
} from '@kedalion/platform';
import { type EditorInfo, forbidden, invalid, isRecord, type Routes } from '@kedalion/server-core';
import type { PickedPaths } from './dialogs.ts';
import { fromPlatform } from './platform-errors.ts';
import type { RootedFs } from './rooted-fs.ts';

export type { EditorInfo };

export interface EditorRoutesOptions {
  /** Folder of editors.json (the overrides), usually `appHome(APP.id)`. */
  dir: string;
  fs: RootedFs;
  /** Paths the in-app file dialog committed (`picks.opened`); `pick` takes its `path` from here. */
  picked: PickedPaths;
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
 * file chosen in the in-app dialog (the client sends the committed `path`) saved in `<dir>/editors.json`; `.cmd` scripts are refused because
 * they would go through cmd.exe.
 */
export function editorRoutes(opts: EditorRoutesOptions): Routes {
  const { dir, fs, picked: pickedSet, find = findEditor, open = openInEditor } = opts;
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
      const b = (await json()) as Record<string, unknown>;
      const editor = editorOf(b.editor);
      const picked = b.path;
      if (typeof picked !== 'string' || !pickedSet.take(picked)) throw forbidden('notAPickedFile', 'Choose a file first.');
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
