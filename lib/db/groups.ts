import "server-only";
import { getDb } from "./client";
import { newId, nowIso } from "./json";

export type GroupRow = {
  id: string;
  group_name: string;
  website_url: string | null;
  tags: string;
  created_at: string;
  updated_at: string;
};

export type GroupInput = {
  group_name: string;
  website_url?: string | null;
  tags?: string;
};

export async function listGroups(): Promise<GroupRow[]> {
  const db = getDb();
  return db.prepare(
    `SELECT id,group_name,website_url,tags,created_at,updated_at FROM group_info ORDER BY group_name ASC`
  ).all() as GroupRow[];
}

export async function getGroupByName(name: string): Promise<GroupRow | null> {
  const db = getDb();
  const row = db.prepare(
    `SELECT id,group_name,website_url,tags,created_at,updated_at FROM group_info WHERE group_name = ?`
  ).get(name) as GroupRow | undefined;
  return row ?? null;
}

export async function getGroup(id: string): Promise<GroupRow | null> {
  const db = getDb();
  const row = db.prepare(
    `SELECT id,group_name,website_url,tags,created_at,updated_at FROM group_info WHERE id = ?`
  ).get(id) as GroupRow | undefined;
  return row ?? null;
}

export async function createGroup(input: GroupInput): Promise<GroupRow> {
  const db = getDb();
  const id = newId();
  const now = nowIso();
  db.prepare(
    `INSERT INTO group_info (id,group_name,website_url,tags,created_at,updated_at)
     VALUES (?,?,?,?,?,?)`
  ).run(id, input.group_name, input.website_url ?? null, input.tags ?? "", now, now);
  return (await getGroup(id))!;
}

export async function updateGroup(id: string, input: Partial<GroupInput>): Promise<GroupRow | null> {
  const db = getDb();
  const existing = db.prepare(`SELECT id FROM group_info WHERE id = ?`).get(id);
  if (!existing) return null;
  const now = nowIso();
  const sets: string[] = ["updated_at = ?"];
  const params: unknown[] = [now];
  if (input.group_name !== undefined) { sets.push("group_name = ?"); params.push(input.group_name); }
  if ("website_url" in input) { sets.push("website_url = ?"); params.push(input.website_url ?? null); }
  if (input.tags !== undefined) { sets.push("tags = ?"); params.push(input.tags); }
  params.push(id);
  db.prepare(`UPDATE group_info SET ${sets.join(",")} WHERE id = ?`).run(...params);
  return getGroup(id);
}

export async function deleteGroup(id: string): Promise<void> {
  const db = getDb();
  db.prepare(`DELETE FROM group_info WHERE id = ?`).run(id);
}
