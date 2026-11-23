import { mkdirSync, readFileSync } from "node:fs";
import { dirname } from "node:path";
import { DatabaseSync, type SQLInputValue } from "node:sqlite";
import { fileURLToPath } from "node:url";
import { dbPath } from "./config.ts";

if (dbPath !== ":memory:") mkdirSync(dirname(dbPath), { recursive: true });
export const db = new DatabaseSync(dbPath);
db.exec("PRAGMA foreign_keys=ON; PRAGMA busy_timeout=5000; PRAGMA journal_mode=WAL;");
export const all = <T>(sql: string, ...params: SQLInputValue[]) => db.prepare(sql).all(...params) as T[];
export const one = <T>(sql: string, ...params: SQLInputValue[]) => db.prepare(sql).get(...params) as T | undefined;
export const run = (sql: string, ...params: SQLInputValue[]) => db.prepare(sql).run(...params);

export function transaction<T>(work: () => T) {
  if (db.isTransaction) return work();
  db.exec("BEGIN IMMEDIATE");
  try {
    const result = work();
    db.exec("COMMIT");
    return result;
  } catch (error) {
    db.exec("ROLLBACK");
    throw error;
  }
}

export function migrate() {
  transaction(() => {
    const migrations = ["001.sql", "002.sql", "003.sql"];
    const version = one<{ user_version: number }>("PRAGMA user_version")?.user_version ?? 0;
    if (version > migrations.length) throw new Error("Версия базы данных новее версии приложения");
    for (let index = version; index < migrations.length; index++) {
      db.exec(readFileSync(new URL("./" + migrations[index], import.meta.url), "utf8"));
      db.exec("PRAGMA user_version=" + (index + 1));
    }
  });
}
migrate();

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) console.log("Миграции SQLite применены.");
