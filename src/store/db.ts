import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";
import initSqlJs from "sql.js";

const SQL = await initSqlJs();

type SqlJsDatabase = InstanceType<typeof SQL.Database>;
type SqlJsStatement = ReturnType<SqlJsDatabase["prepare"]>;
type StatementBindParams = Parameters<SqlJsStatement["bind"]>[0];
type Params = unknown[] | Record<string, unknown>;
type SqlValue = number | string | Uint8Array | null;

export interface RunResult {
  changes: number;
  lastInsertRowid: number;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function normalizeParams(params: unknown[]): Params | undefined {
  if (params.length === 0) return undefined;
  if (params.length === 1) {
    const [first] = params;
    if (Array.isArray(first)) return first;
    if (isRecord(first)) return first;
  }
  return params;
}

function toSqlValue(value: unknown): SqlValue {
  if (value === null || value === undefined) return null;
  if (typeof value === "number" || typeof value === "string") return value;
  if (value instanceof Uint8Array) return value;
  if (typeof value === "boolean") return value ? 1 : 0;
  if (value instanceof Date) return value.toISOString();
  return JSON.stringify(value);
}

function toBindParams(params: Params | undefined): StatementBindParams {
  if (!params) return undefined;
  if (Array.isArray(params)) {
    return params.map(toSqlValue);
  }

  const entries = Object.entries(params).map(
    ([key, value]) => [key, toSqlValue(value)] as const,
  );
  return Object.fromEntries(entries);
}

export interface SqliteStatement<Result = unknown> {
  all(...params: unknown[]): Result[];
  get(...params: unknown[]): Result | undefined;
  run(...params: unknown[]): RunResult;
}

class WrappedStatement<Result = unknown> implements SqliteStatement<Result> {
  constructor(
    private readonly database: SqliteDatabase,
    private readonly sql: string,
  ) {}

  all(...params: unknown[]): Result[] {
    const stmt = this.database.getRawDb().prepare(this.sql);
    try {
      const bindParams = toBindParams(normalizeParams(params));
      if (bindParams !== undefined) {
        stmt.bind(bindParams);
      }

      const rows: Result[] = [];
      while (stmt.step()) {
        rows.push(stmt.getAsObject() as unknown as Result);
      }
      return rows;
    } finally {
      stmt.free();
    }
  }

  get(...params: unknown[]): Result | undefined {
    return this.all(...params)[0];
  }

  run(...params: unknown[]): RunResult {
    return this.database.runWithParams(this.sql, normalizeParams(params));
  }
}

export class SqliteDatabase {
  private readonly dbPath: string;
  private readonly db: SqlJsDatabase;
  private closed = false;
  private transactionDepth = 0;

  constructor(filename: string) {
    this.dbPath = filename;
    mkdirSync(dirname(filename), { recursive: true });
    if (existsSync(filename)) {
      this.db = new SQL.Database(readFileSync(filename));
      return;
    }
    this.db = new SQL.Database();
  }

  pragma(source: string): unknown {
    const result = this.db.exec(`PRAGMA ${source}`);
    this.save();
    return result;
  }

  run(sql: string, params?: unknown[]): RunResult | void {
    return this.runWithParams(sql, params);
  }

  runWithParams(sql: string, params?: Params): RunResult {
    this.db.run(sql, toBindParams(params));
    const result: RunResult = {
      changes: this.db.getRowsModified(),
      lastInsertRowid: this.getLastInsertRowid(),
    };
    if (this.transactionDepth === 0) {
      this.save();
    }
    return result;
  }

  prepare<Result = unknown>(sql: string): SqliteStatement<Result> {
    return new WrappedStatement<Result>(this, sql);
  }

  query<Result = unknown>(sql: string): SqliteStatement<Result> {
    return this.prepare<Result>(sql);
  }

  transaction<T extends (...args: unknown[]) => unknown>(fn: T): T {
    return ((...args: unknown[]) => {
      this.db.run("BEGIN");
      this.transactionDepth += 1;
      try {
        const result = fn(...args);
        this.db.run("COMMIT");
        this.transactionDepth -= 1;
        if (this.transactionDepth === 0) {
          this.save();
        }
        return result;
      } catch (error) {
        try {
          this.db.run("ROLLBACK");
        } finally {
          this.transactionDepth = Math.max(0, this.transactionDepth - 1);
          if (this.transactionDepth === 0) {
            this.save();
          }
        }
        throw error;
      }
    }) as T;
  }

  close(): void {
    if (this.closed) return;
    this.save();
    this.db.close();
    this.closed = true;
  }

  getRawDb(): SqlJsDatabase {
    return this.db;
  }

  private save(): void {
    if (this.closed) return;
    const bytes = this.db.export();
    writeFileSync(this.dbPath, Buffer.from(bytes));
  }

  private getLastInsertRowid(): number {
    const stmt = this.db.prepare("SELECT last_insert_rowid() AS id");
    try {
      if (!stmt.step()) return 0;
      const row = stmt.getAsObject();
      const id = row.id;
      if (typeof id === "number") return id;
      if (typeof id === "string") {
        const parsed = Number(id);
        return Number.isFinite(parsed) ? parsed : 0;
      }
      return 0;
    } finally {
      stmt.free();
    }
  }
}
