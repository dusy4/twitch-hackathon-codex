import { PGlite } from "@electric-sql/pglite";
import pg from "pg";
import { readFile, mkdir } from "node:fs/promises";
export interface SQL {
  query<T extends Record<string, any> = Record<string, any>>(
    sql: string,
    args?: any[],
  ): Promise<{ rows: T[] }>;
}
export class Database implements SQL {
  private queue: Promise<unknown> = Promise.resolve();
  constructor(private engine: PGlite | pg.Pool) {}
  static async open(url?: string) {
    if (url)
      return new Database(new pg.Pool({ connectionString: url, max: 10 }));
    await mkdir(".data", { recursive: true });
    return new Database(new PGlite(".data/postgres"));
  }
  static memory() {
    return new Database(new PGlite());
  }
  async query<T extends Record<string, any> = Record<string, any>>(
    sql: string,
    args: any[] = [],
  ): Promise<{ rows: T[] }> {
    return this.exclusive(() => (this.engine as SQL).query(sql, args) as any);
  }
  private exclusive<T>(fn: () => Promise<T>): Promise<T> {
    const result = this.queue.then(fn, fn);
    this.queue = result.catch(() => {});
    return result;
  }
  async migrate() {
    const sql = await readFile(
      new URL("../../migrations/001_core.sql", import.meta.url),
      "utf8",
    );
    if (this.engine instanceof PGlite) await this.engine.exec(sql);
    else await this.engine.query(sql);
  }
  async transaction<T>(fn: (tx: SQL) => Promise<T>): Promise<T> {
    return this.exclusive(async () => {
      const conn =
        this.engine instanceof pg.Pool
          ? await this.engine.connect()
          : this.engine;
      try {
        await (conn as SQL).query("BEGIN");
        const value = await fn({
          query: (sql, args = []) => (conn as SQL).query(sql, args) as any,
        });
        await (conn as SQL).query("COMMIT");
        return value;
      } catch (e) {
        await (conn as SQL).query("ROLLBACK");
        throw e;
      } finally {
        if ("release" in conn) conn.release();
      }
    });
  }
  async close() {
    await this.queue;
    if (this.engine instanceof PGlite) await this.engine.close();
    else await this.engine.end();
  }
}
