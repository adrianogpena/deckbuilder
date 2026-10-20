export interface DemoRow {
  id: number;
  name: string;
  amount: number;
  date: string;
}

export interface DbStatus {
  connected: boolean;
  /** Uncommitted changes may exist. */
  pending: boolean;
  busy: boolean;
}

export interface DbColumn {
  name: string;
  type: 'number' | 'text' | 'date' | 'binary';
  /** A TIMESTAMP column (also reported as type `date`). */
  timestamp?: boolean;
}

export interface DbSchemaTable {
  name: string;
  kind: 'table' | 'view';
  columns: Array<{ name: string; type: string; nullable: boolean }>;
}

export interface DbSchema {
  owner: string;
  owners: string[];
  tables: DbSchemaTable[];
  truncated: boolean;
}

export interface DbTableIndex {
  name: string;
  unique: boolean;
  columns: string[];
}

export interface DbTableConstraint {
  name: string;
  /** Primary key, unique, foreign key (references), check. */
  type: 'P' | 'U' | 'R' | 'C';
  columns: string[];
  condition?: string;
  references?: { owner: string; table: string; constraint: string; columns: string[] };
}

export interface DbTableDetails {
  owner: string;
  name: string;
  indexes: DbTableIndex[];
  constraints: DbTableConstraint[];
  ddl: string | null;
}

/** One step of an EXPLAIN PLAN, as PLAN_TABLE holds it. */
export interface DbPlanRow {
  id: number;
  parentId: number | null;
  depth: number;
  operation: string;
  options: string | null;
  objectOwner: string | null;
  objectName: string | null;
  cost: number | null;
  cardinality: number | null;
  bytes: number | null;
  accessPredicates: string | null;
  filterPredicates: string | null;
}

export type DbRunResult = { kind: 'rows'; run: string; columns: DbColumn[] } | { kind: 'done'; rowsAffected?: number };

/** A saved database connection; the password is never returned, only whether one is stored. */
export interface DbConnection {
  id: string;
  name: string;
  url: string;
  user: string;
  password?: { hasSecret: true };
}

/** The server calls the SQL hooks make; the app builds it from its api and passes it to each hook. */
export interface SqlClient {
  connections: () => Promise<DbConnection[]>;
  saveDemo: (path: string, text: string) => Promise<unknown>;
  dbRun: (id: string, sql: string, maxRows?: number) => Promise<DbRunResult>;
  dbExplain: (id: string, sql: string) => Promise<DbPlanRow[]>;
  dbTable: (id: string, owner: string, name: string) => Promise<DbTableDetails>;
  dbSchema: (id: string, owner?: string) => Promise<DbSchema>;
  dbCommit: (id: string) => Promise<DbStatus>;
  dbRollback: (id: string) => Promise<DbStatus>;
  dbDisconnect: (id: string) => Promise<DbStatus>;
  dbStatus: (id: string) => Promise<DbStatus>;
}
