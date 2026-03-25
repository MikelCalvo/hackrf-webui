import { existsSync, mkdirSync, readdirSync, readFileSync } from "node:fs";
import path from "node:path";

import Database from "better-sqlite3";

const rootDir = path.resolve(path.dirname(new URL(import.meta.url).pathname), "..", "..");
const dbDir = path.join(rootDir, "db");
const dbPath = process.env.HACKRF_WEBUI_DB_PATH?.trim() || path.join(dbDir, "app.sqlite");
const migrationsDir = path.join(dbDir, "migrations");

function log(message) {
  process.stdout.write(`[db] ${message}\n`);
}

function ensureDatabaseDirectory() {
  mkdirSync(dbDir, { recursive: true });
}

function configureDatabase(sqlite) {
  sqlite.pragma("journal_mode = WAL");
  sqlite.pragma("synchronous = NORMAL");
  sqlite.pragma("foreign_keys = ON");
  sqlite.pragma("busy_timeout = 5000");
}

function ensureMigrationTable(sqlite) {
  sqlite.exec(`
    CREATE TABLE IF NOT EXISTS __app_migrations (
      name TEXT PRIMARY KEY NOT NULL,
      applied_at_ms INTEGER NOT NULL
    );
  `);
}

function appliedMigrationNames(sqlite) {
  return new Set(
    sqlite
      .prepare("SELECT name FROM __app_migrations ORDER BY name ASC")
      .all()
      .map((row) => row.name),
  );
}

function migrationFiles() {
  if (!existsSync(migrationsDir)) {
    return [];
  }

  return readdirSync(migrationsDir)
    .filter((fileName) => fileName.endsWith(".sql"))
    .sort((left, right) => left.localeCompare(right));
}

function applyMigration(sqlite, fileName) {
  const sql = readFileSync(path.join(migrationsDir, fileName), "utf8");
  const apply = sqlite.transaction(() => {
    sqlite.exec(sql);
    sqlite
      .prepare("INSERT INTO __app_migrations (name, applied_at_ms) VALUES (?, ?)")
      .run(fileName, Date.now());
  });

  apply();
}

ensureDatabaseDirectory();
const sqlite = new Database(dbPath);
configureDatabase(sqlite);
ensureMigrationTable(sqlite);

const applied = appliedMigrationNames(sqlite);
let appliedCount = 0;

for (const fileName of migrationFiles()) {
  if (applied.has(fileName)) {
    continue;
  }

  applyMigration(sqlite, fileName);
  appliedCount += 1;
  log(`applied ${fileName}`);
}

sqlite.close();
log(`ready at ${dbPath}${appliedCount === 0 ? " (no new migrations)" : ""}`);
