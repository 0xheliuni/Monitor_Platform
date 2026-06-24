import "server-only";
import { getDb } from "./client";
import { newId, nowIso, toBool, fromBool } from "./json";

export type NotificationRow = {
  id: string;
  message: string;
  is_active: boolean;
  level: string;
  created_at: string;
};

type NotificationRaw = {
  id: string;
  message: string;
  is_active: 0 | 1;
  level: string;
  created_at: string;
};

function mapRow(r: NotificationRaw): NotificationRow {
  return {
    id: r.id,
    message: r.message,
    is_active: toBool(r.is_active),
    level: r.level,
    created_at: r.created_at,
  };
}

export type NotificationInput = {
  message: string;
  is_active?: boolean;
  level?: string;
};

export async function listNotifications(): Promise<NotificationRow[]> {
  const db = getDb();
  const rows = db.prepare(
    `SELECT id,message,is_active,level,created_at FROM system_notifications ORDER BY created_at DESC`
  ).all() as NotificationRaw[];
  return rows.map(mapRow);
}

export async function listActiveNotifications(): Promise<NotificationRow[]> {
  const db = getDb();
  const rows = db.prepare(
    `SELECT id,message,is_active,level,created_at FROM system_notifications WHERE is_active = 1 ORDER BY created_at DESC`
  ).all() as NotificationRaw[];
  return rows.map(mapRow);
}

export async function getNotification(id: string): Promise<NotificationRow | null> {
  const db = getDb();
  const row = db.prepare(
    `SELECT id,message,is_active,level,created_at FROM system_notifications WHERE id = ?`
  ).get(id) as NotificationRaw | undefined;
  return row ? mapRow(row) : null;
}

export async function createNotification(input: NotificationInput): Promise<NotificationRow> {
  const db = getDb();
  const id = newId();
  const now = nowIso();
  const isActive = input.is_active !== undefined ? input.is_active : true;
  const level = input.level ?? "info";
  db.prepare(
    `INSERT INTO system_notifications (id,message,is_active,level,created_at)
     VALUES (?,?,?,?,?)`
  ).run(id, input.message, fromBool(isActive), level, now);
  return (await getNotification(id))!;
}

export async function updateNotification(id: string, input: Partial<NotificationInput>): Promise<NotificationRow | null> {
  const db = getDb();
  const existing = db.prepare(`SELECT id FROM system_notifications WHERE id = ?`).get(id);
  if (!existing) return null;
  const sets: string[] = [];
  const params: unknown[] = [];
  if (input.message !== undefined) { sets.push("message = ?"); params.push(input.message); }
  if (input.is_active !== undefined) { sets.push("is_active = ?"); params.push(fromBool(input.is_active)); }
  if (input.level !== undefined) { sets.push("level = ?"); params.push(input.level); }
  if (sets.length === 0) return getNotification(id);
  params.push(id);
  db.prepare(`UPDATE system_notifications SET ${sets.join(",")} WHERE id = ?`).run(...params);
  return getNotification(id);
}

export async function deleteNotification(id: string): Promise<void> {
  const db = getDb();
  db.prepare(`DELETE FROM system_notifications WHERE id = ?`).run(id);
}
