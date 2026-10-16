import { bool, groupField, oneOf, type SettingDef } from './settings-schema';

/** The shared `git` settings group: read by the Explorer and the Git view. */
export interface GitSettings {
  /** How the Git screen lays out a diff. */
  diffMode?: 'split' | 'inline';
  /** Whether the Explorer tree colours changed files and marks them with their git status. */
  explorerDecorations?: boolean;
}

/** The part of the app settings that holds the git group. */
export interface GitGroupSettings {
  git?: GitSettings;
}

export const GIT_DEFAULTS: Required<GitSettings> = { diffMode: 'split', explorerDecorations: true };

/** The schema rows of the git group; the app registers them once. */
export const gitSettingDefs: SettingDef<GitGroupSettings>[] = [
  groupField<GitGroupSettings, 'git'>('git', 'diffMode', 100, oneOf('split', ['split', 'inline'])),
  groupField<GitGroupSettings, 'git'>('git', 'explorerDecorations', 110, bool(true), ['explorer']),
];

/** The git settings with their defaults filled in. */
export const gitSettingsOf = (s: GitGroupSettings): Required<GitSettings> => ({ ...GIT_DEFAULTS, ...s.git });
