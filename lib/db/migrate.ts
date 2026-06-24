import "server-only";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import type Database from "better-sqlite3";
import { getDb } from "./client";

export function runMigrations(db: Database.Database = getDb()): void {
  const schemaPath = resolve(process.cwd(), "lib/db/schema.sql");
  const sql = readFileSync(schemaPath, "utf8");
  db.exec(sql);
}
