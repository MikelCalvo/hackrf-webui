import "server-only";

import { existsSync, mkdirSync, readdirSync, readFileSync } from "node:fs";
import path from "node:path";

import Database from "better-sqlite3";
import { drizzle } from "drizzle-orm/better-sqlite3";

import * as schema from "@/server/db/schema";

const DB_DIR = path.join(/*turbopackIgnore: true*/ process.cwd(), "db");
const DB_PATH = process.env.HACKRF_WEBUI_DB_PATH?.trim()
  || path.join(/*turbopackIgnore: true*/ process.cwd(), "db", "app.sqlite");
const MIGRATIONS_DIR = path.join(/*turbopackIgnore: true*/ process.cwd(), "db", "migrations");

function ensureMigrationTable(sqlite: Database.Database): void {
  sqlite.exec(`
    CREATE TABLE IF NOT EXISTS __app_migrations (
      name TEXT PRIMARY KEY NOT NULL,
      applied_at_ms INTEGER NOT NULL
    );
  `);
}

function applyPendingMigrations(sqlite: Database.Database): void {
  ensureMigrationTable(sqlite);

  if (!existsSync(MIGRATIONS_DIR)) {
    return;
  }

  const files = readdirSync(MIGRATIONS_DIR)
    .filter((fileName) => fileName.endsWith(".sql"))
    .sort((left, right) => left.localeCompare(right));

  for (const fileName of files) {
    const sql = readFileSync(path.join(MIGRATIONS_DIR, fileName), "utf8");
    const apply = sqlite.transaction(() => {
      const alreadyApplied = sqlite
        .prepare("SELECT 1 FROM __app_migrations WHERE name = ? LIMIT 1")
        .get(fileName);
      if (alreadyApplied) {
        return;
      }

      sqlite.exec(sql);
      sqlite
        .prepare("INSERT OR IGNORE INTO __app_migrations (name, applied_at_ms) VALUES (?, ?)")
        .run(fileName, Date.now());
    }).immediate;

    apply();
  }
}

function createDatabaseClient() {
  mkdirSync(DB_DIR, { recursive: true });

  const sqlite = new Database(DB_PATH);
  sqlite.pragma("journal_mode = WAL");
  sqlite.pragma("synchronous = NORMAL");
  sqlite.pragma("foreign_keys = ON");
  sqlite.pragma("busy_timeout = 5000");
  applyPendingMigrations(sqlite);

  return {
    sqlite,
    db: drizzle(sqlite, { schema }),
  };
}

declare global {
  var __hackrfWebUiSqlite:
    | {
        sqlite: Database.Database;
        db: ReturnType<typeof drizzle<typeof schema>>;
      }
    | undefined;
}

const runtime = global.__hackrfWebUiSqlite ?? createDatabaseClient();

if (process.env.NODE_ENV !== "production") {
  global.__hackrfWebUiSqlite = runtime;
}

export const sqliteDb = runtime.sqlite;
export const appDb = runtime.db;
export const appDbPath = DB_PATH;
