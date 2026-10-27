import { useSyncExternalStore } from 'react';
import type { Tone } from './components/ui';
import { effectiveName, LOG_NAME } from './file-associations';
import type { IconName } from './icons';

export interface FileIcon {
  icon: IconName;
  tone?: Tone;
}

const BY_EXTENSION: Record<string, FileIcon> = Object.create(null);
const add = (extensions: string, icon: IconName, tone?: Tone) => {
  for (const ext of extensions.split(' ')) BY_EXTENSION[ext] = { icon, tone };
};
add('sql pls pkb pks', 'database', 'info');
add('json jsonc', 'braces', 'warn');
add('md markdown', 'markdown', 'info');
add('log', 'log-file', 'ok');
add('curl http rest', 'curl', 'ok');
add('png jpg jpeg gif webp bmp ico avif tif tiff', 'image', 'info');
add('svg', 'vector', 'warn');
add('pdf', 'pdf', 'err');
add('mp4 mkv mov avi webm wmv m4v', 'video', 'info');
add('mp3 wav flac ogg m4a aac opus', 'audio', 'info');
add('doc docx odt rtf', 'document', 'info');
add('ppt pptx odp', 'slides', 'warn');
add('ttf otf woff woff2', 'font', 'muted');
add('exe dll msi so dylib bin', 'app', 'muted');
add('lock', 'lock', 'muted');
add('csv tsv xlsx xls ods', 'table', 'ok');
add('js ts tsx jsx java kt py go rs cs c cpp h html css scss', 'code');
add('sh bash ps1 bat cmd', 'terminal');
add('zip jar war gz tgz 7z rar', 'archive');
add('pem key crt p12 jks', 'key', 'err');
add('yaml yml toml ini properties conf cfg xml', 'settings-file');
add('txt', 'file-text');

/** Extensions the active icon set draws with its own file icon (atom); set by LayoutProvider. */
let variantExts: ReadonlySet<string> = new Set();
let variantVersion = 0;
const variantListeners = new Set<() => void>();
export function setFileIconVariants(keys: Iterable<string> | undefined): void {
  const next = new Set([...(keys ?? [])].map((k) => k.slice(k.indexOf(':') + 1)));
  if (next.size === variantExts.size && [...next].every((e) => variantExts.has(e))) return;
  variantExts = next;
  variantVersion++;
  for (const listener of variantListeners) listener();
}
const subscribeVariants = (listener: () => void) => {
  variantListeners.add(listener);
  return () => variantListeners.delete(listener);
};
const variantSnapshot = () => variantVersion;
/** Re-renders the caller when the active set's file-icon variants change; call it in components that use fileIconOf/folderIconOf while rendering. */
export function useFileIconVersion(): number {
  return useSyncExternalStore(subscribeVariants, variantSnapshot, variantSnapshot);
}

const CONFIG_FILE: FileIcon = { icon: 'settings-file' };
const LOG_FILE: FileIcon = { icon: 'log-file', tone: 'ok' };

/** Icon and tone of a file by its (lower-cased) extension or whole name, after the user's file associations. */
export function fileIconOf(name: string): FileIcon {
  const lower = effectiveName(name).toLowerCase();
  if (LOG_NAME.test(lower)) return LOG_FILE;
  if (lower === '.env' || lower.startsWith('.env.') || lower === 'dockerfile' || lower === '.gitignore') return CONFIG_FILE;
  const dot = lower.lastIndexOf('.');
  const ext = lower.slice(dot + 1);
  const hit = dot >= 0 ? BY_EXTENSION[ext] : undefined;
  if (!hit) return { icon: 'file' };
  // `<icon>:<ext>` is drawn per extension by the active set; Icon falls back to `<icon>` elsewhere.
  return variantExts.has(ext) ? { ...hit, icon: `${hit.icon}:${ext}` as IconName } : hit;
}

const FOLDER_NAMES: Record<string, IconName> = Object.create(null);
const addFolders = (names: string, icon: IconName) => {
  for (const n of names.split(' ')) FOLDER_NAMES[n] = icon;
};
addFolders('sql db database migrations flyway liquibase', 'folder-database');
addFolders('curl http requests rest api postman', 'folder-send');
addFolders('log logs', 'folder-log');
addFolders('doc docs', 'folder-docs');
addFolders('test tests __tests__ spec specs', 'folder-test');
addFolders('src lib', 'folder-code');
addFolders('config conf settings .vscode .idea', 'folder-config');
addFolders('img images assets icons', 'folder-image');
addFolders('bin scripts', 'folder-terminal');
addFolders('.git', 'folder-git');
addFolders('node_modules target dist build out', 'folder-build');

const BY_CONTENT: Partial<Record<IconName, IconName>> = {
  database: 'folder-database',
  curl: 'folder-send',
  'log-file': 'folder-log',
  markdown: 'folder-docs',
  image: 'folder-image',
  code: 'folder-code',
  terminal: 'folder-terminal',
  'settings-file': 'folder-config',
};

/** Icon of a folder: by name first, then by `childFiles` when there are at least two and all of one kind. */
export function folderIconOf(name: string, childFiles?: string[]): IconName {
  const byName = FOLDER_NAMES[name.toLowerCase()];
  if (byName) return byName;
  if (!childFiles || childFiles.length < 2) return 'folder';
  const kinds = new Set(childFiles.map((f) => fileIconOf(f).icon.split(':')[0] as IconName));
  if (kinds.size !== 1) return 'folder';
  return BY_CONTENT[[...kinds][0]] ?? 'folder';
}
