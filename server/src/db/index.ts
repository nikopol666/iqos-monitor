import Database from "better-sqlite3";
import { drizzle, type BetterSQLite3Database } from "drizzle-orm/better-sqlite3";
import fs from "node:fs";
import path from "node:path";
import * as schema from "./schema";
import { MIGRATIONS } from "./bootstrap.sql";

export type Db = BetterSQLite3Database<typeof schema>;

const DEFAULT_PATH = path.join(process.cwd(), "data", "iqos.sqlite3");

interface Handle {
  sqlite: Database.Database;
  db: Db;
}

// One connection per process; survives Next.js dev hot reloads via globalThis.
const globalRef = globalThis as unknown as { __iqosDb?: Handle };

function open(): Handle {
  const file = process.env.DATABASE_PATH || DEFAULT_PATH;
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const sqlite = new Database(file, { timeout: 10_000 });
  sqlite.pragma("journal_mode = WAL");
  sqlite.pragma("synchronous = NORMAL");
  sqlite.pragma("foreign_keys = ON");
  const current = sqlite.pragma("user_version", { simple: true }) as number;
  for (let v = current; v < MIGRATIONS.length; v++) {
    sqlite.transaction(() => {
      sqlite.exec(MIGRATIONS[v]);
      sqlite.pragma(`user_version = ${v + 1}`);
    })();
  }
  const db = drizzle(sqlite, { schema });
  return { sqlite, db };
}

export function getDb(): Db {
  if (!globalRef.__iqosDb) globalRef.__iqosDb = open();
  return globalRef.__iqosDb.db;
}

export function getSqlite(): Database.Database {
  if (!globalRef.__iqosDb) globalRef.__iqosDb = open();
  return globalRef.__iqosDb.sqlite;
}

export function nowUtc(): string {
  return new Date().toISOString().replace(/\.\d{3}Z$/, "+00:00");
}

export { schema };
