// The part of oracledb 6.10 (thin mode) this package uses; the driver ships no types.
declare module 'oracledb' {
  interface DbType {
    readonly num: number;
    readonly name: string;
  }
  interface FetchMetadata {
    name: string;
    dbType: DbType;
  }
  interface FetchTypeResult {
    type?: DbType;
    converter?: (value: any) => unknown;
  }
  interface OracleDb {
    OUT_FORMAT_ARRAY: number;
    STRING: DbType;
    BUFFER: DbType;
    getConnection(attrs: { connectString: string; user: string; password: string; connectTimeout?: number }): Promise<any>;
  }
  const oracledb: OracleDb;
  export default oracledb;
  export type { DbType, FetchMetadata, FetchTypeResult };
}
