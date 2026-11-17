import { readdirSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { fileURLToPath } from "node:url";

const MIGRATIONS = join(dirname(fileURLToPath(import.meta.url)), "../../../database/migrations");

type Value = string | number | null;

/**
 * An in-memory SQLite database with the slice of the D1 API Synthora uses,
 * with every migration applied. Runs the real SQL, so tests catch schema and
 * query mistakes.
 */
export function testD1(): D1Database {
  const db = new DatabaseSync(":memory:");
  for (const file of readdirSync(MIGRATIONS).filter((f) => f.endsWith(".sql")).sort()) {
    db.exec(readFileSync(join(MIGRATIONS, file), "utf8"));
  }
  const prepare = (sql: string) => {
    let args: Value[] = [];
    const statement = {
      bind(...values: Value[]) {
        args = values;
        return statement;
      },
      async first<T>() {
        return (db.prepare(sql).get(...args) as T | undefined) ?? null;
      },
      async all<T>() {
        return { results: db.prepare(sql).all(...args) as T[], success: true, meta: {} };
      },
      async run() {
        const r = db.prepare(sql).run(...args);
        return { success: true, meta: { changes: Number(r.changes) } };
      },
    };
    return statement;
  };
  return { prepare } as unknown as D1Database;
}
