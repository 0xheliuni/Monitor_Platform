import "server-only";
import Database from "better-sqlite3";

let db: Database.Database | null = null;

export function getDb(): Database.Database {
  if (db) return db;
  const path = process.env.SQLITE_DB_PATH ?? "./data/monitor.db";
  const instance = new Database(path);
  instance.pragma("journal_mode = WAL");
  instance.pragma("foreign_keys = ON");
  instance.pragma("busy_timeout = 5000");
  db = instance;
  return db;
}

// 测试用：注入内存库或自定义实例
export function __setDbForTest(instance: Database.Database | null): void {
  db = instance;
}
