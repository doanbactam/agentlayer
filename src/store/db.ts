import BetterSqlite3 from "better-sqlite3"

type Params = unknown[] | Record<string, unknown>
type RunResult = ReturnType<BetterSqlite3.Database["prepare"]> extends {
  run: (...args: never[]) => infer TResult
}
  ? TResult
  : unknown

function normalizeParams(params: unknown[]): Params {
  if (params.length === 1) {
    const [first] = params
    if (Array.isArray(first)) return first
    if (first && typeof first === "object") return first as Record<string, unknown>
  }
  return params
}

export interface SqliteStatement<Result = unknown> {
  all(...params: unknown[]): Result[]
  get(...params: unknown[]): Result | undefined
  run(...params: unknown[]): RunResult
}

class WrappedStatement<Result = unknown> implements SqliteStatement<Result> {
  constructor(
    private readonly stmt: BetterSqlite3.Statement<unknown[] | Record<string, unknown>, Result>,
  ) {}

  all(...params: unknown[]): Result[] {
    return this.stmt.all(normalizeParams(params) as never)
  }

  get(...params: unknown[]): Result | undefined {
    return this.stmt.get(normalizeParams(params) as never)
  }

  run(...params: unknown[]): RunResult {
    return this.stmt.run(normalizeParams(params) as never)
  }
}

export class SqliteDatabase {
  private readonly db: BetterSqlite3.Database

  constructor(filename: string) {
    this.db = new BetterSqlite3(filename)
  }

  pragma(source: string): unknown {
    return this.db.pragma(source)
  }

  run(sql: string, params?: unknown[]): RunResult | void {
    if (!params || params.length === 0) {
      this.db.exec(sql)
      return
    }
    return this.db.prepare(sql).run(...params as never[])
  }

  prepare<Result = unknown>(sql: string): SqliteStatement<Result> {
    return new WrappedStatement(this.db.prepare(sql))
  }

  query<Result = unknown>(sql: string): SqliteStatement<Result> {
    return this.prepare<Result>(sql)
  }

  transaction<T extends (...args: never[]) => unknown>(fn: T): T {
    return this.db.transaction(fn) as unknown as T
  }

  close(): void {
    this.db.close()
  }
}
