import type { Tone } from './components/ui';
import type { IconName } from './icons';

export interface FileIcon {
  icon: IconName;
  tone?: Tone;
}

const BY_EXTENSION: Record<string, FileIcon> = {};
const add = (extensions: string, icon: IconName, tone?: Tone) => {
  for (const ext of extensions.split(' ')) BY_EXTENSION[ext] = { icon, tone };
};
add('sql pls pkb pks', 'database', 'info');
add('json jsonc', 'braces', 'warn');
add('md markdown', 'markdown', 'info');
add('log', 'log', 'muted');
add('curl http rest', 'curl', 'ok');
add('png jpg jpeg gif webp bmp ico svg', 'image');
add('csv tsv xlsx xls', 'table', 'ok');
add('js ts tsx jsx java kt py go rs cs c cpp h html css scss', 'code');
add('sh bash ps1 bat cmd', 'terminal');
add('zip jar war gz tgz 7z rar', 'archive');
add('pem key crt p12 jks', 'key', 'err');
add('yaml yml toml ini properties conf cfg xml', 'settings-file');
add('txt pdf', 'file-text');

const CONFIG_FILE: FileIcon = { icon: 'settings-file' };

/** Icon and tone of a file by its (lower-cased) extension or whole name. */
export function fileIconOf(name: string): FileIcon {
  const lower = name.toLowerCase();
  if (lower === '.env' || lower.startsWith('.env.') || lower === 'dockerfile' || lower === '.gitignore') return CONFIG_FILE;
  const dot = lower.lastIndexOf('.');
  return (dot >= 0 && BY_EXTENSION[lower.slice(dot + 1)]) || { icon: 'file' };
}

const FOLDER_NAMES: Record<string, IconName> = {};
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
  log: 'folder-log',
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
  const kinds = new Set(childFiles.map((f) => fileIconOf(f).icon));
  if (kinds.size !== 1) return 'folder';
  return BY_CONTENT[[...kinds][0]] ?? 'folder';
}
