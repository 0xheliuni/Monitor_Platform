import "server-only";
import { isAbsolute, resolve } from "node:path";
import Database from "better-sqlite3";

let db: Database.Database | null = null;

export function getDb(): Database.Database {
  if (db) return db;
  const configured = process.env.SQLITE_DB_PATH ?? "./data/monitor.db";
  // 显式相对 cwd 解析，避免运行时工作目录变化导致 db 落到意外位置。
  const path = isAbsolute(configured) ? configured : resolve(process.cwd(), configured);
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
