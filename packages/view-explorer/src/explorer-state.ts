/** The stored Explorer state. */
export interface ExplorerSettings {
  /** Fractions of the sidebar and the workspace. */
  sizes: [number, number];
  collapsed: boolean;
  /** Expanded tree node ids per project id. */
  expanded: Record<string, string[]>;
  /** Project ids shown in the sidebar, 1 or 2. */
  trees?: string[];
  /** Fractions of the two trees when `trees` has 2. */
  treeSizes?: [number, number];
  /** Edit / split / preview of markdown files; live when omitted. */
  markdownMode?: 'live' | 'edit' | 'split' | 'preview';
  /** Wrap long lines in the file editors; on when omitted. */
  wrapLines?: boolean;
  /** Fractions of the SQL editor and its results panel. */
  sqlSizes?: [number, number];
  /** Last database connection id used per project id, for SQL files. */
  connections?: Record<string, string>;
  tabs?: unknown;
}
