import "server-only";
import { getDb } from "./client";
import { newId, nowIso, toBool, fromBool } from "./json";
import { encryptSecret, decryptSecret } from "./monitor-crypto";
import type { MonitorTargetRow, TargetKind } from "../types/monitor";

export type TargetInput = {
  name: string;
  base_url: string;
  kind: TargetKind;
  admin_token: string | null;
  admin_user_id: string | null;
  probe_api_key: string | null;
  group_name: string | null;
  enabled: boolean;
};

type TargetRaw = {
  id: string; name: string; base_url: string; kind: TargetKind;
  admin_token: string | null; admin_user_id: string | null; probe_api_key: string | null;
  group_name: string | null; enabled: 0 | 1; created_at: string; updated_at: string;
};

function dec(stored: string | null): string | null {
  return stored ? decryptSecret(stored) : null;
}

function mapRow(r: TargetRaw): MonitorTargetRow {
  return {
    id: r.id, name: r.name, base_url: r.base_url, kind: r.kind,
    admin_token: dec(r.admin_token), admin_user_id: r.admin_user_id,
    probe_api_key: dec(r.probe_api_key), group_name: r.group_name,
    enabled: toBool(r.enabled), created_at: r.created_at, updated_at: r.updated_at,
  };
}

const COLS = "id,name,base_url,kind,admin_token,admin_user_id,probe_api_key,group_name,enabled,created_at,updated_at";

export async function listTargets(): Promise<MonitorTargetRow[]> {
  const rows = getDb().prepare(`SELECT ${COLS} FROM monitor_targets ORDER BY name ASC`).all() as TargetRaw[];
  return rows.map(mapRow);
}

export async function getTarget(id: string): Promise<MonitorTargetRow | null> {
  const row = getDb().prepare(`SELECT ${COLS} FROM monitor_targets WHERE id = ?`).get(id) as TargetRaw | undefined;
  return row ? mapRow(row) : null;
}

export async function createTarget(input: TargetInput): Promise<MonitorTargetRow> {
  const db = getDb();
  const id = newId();
  const now = nowIso();
  db.prepare(
    `INSERT INTO monitor_targets (${COLS}) VALUES (?,?,?,?,?,?,?,?,?,?,?)`
  ).run(
    id, input.name, input.base_url, input.kind,
    input.admin_token ? encryptSecret(input.admin_token) : null,
    input.admin_user_id,
    input.probe_api_key ? encryptSecret(input.probe_api_key) : null,
    input.group_name, fromBool(input.enabled), now, now
  );
  return (await getTarget(id))!;
}

export async function updateTarget(id: string, input: Partial<TargetInput>): Promise<MonitorTargetRow | null> {
  const db = getDb();
  const exists = db.prepare("SELECT id FROM monitor_targets WHERE id = ?").get(id);
  if (!exists) return null;
  const sets: string[] = ["updated_at = ?"];
  const params: unknown[] = [nowIso()];
  if (input.name !== undefined) { sets.push("name = ?"); params.push(input.name); }
  if (input.base_url !== undefined) { sets.push("base_url = ?"); params.push(input.base_url); }
  if (input.kind !== undefined) { sets.push("kind = ?"); params.push(input.kind); }
  if ("admin_token" in input) { sets.push("admin_token = ?"); params.push(input.admin_token ? encryptSecret(input.admin_token) : null); }
  if ("admin_user_id" in input) { sets.push("admin_user_id = ?"); params.push(input.admin_user_id ?? null); }
  if ("probe_api_key" in input) { sets.push("probe_api_key = ?"); params.push(input.probe_api_key ? encryptSecret(input.probe_api_key) : null); }
  if ("group_name" in input) { sets.push("group_name = ?"); params.push(input.group_name ?? null); }
  if (input.enabled !== undefined) { sets.push("enabled = ?"); params.push(fromBool(input.enabled)); }
  params.push(id);
  db.prepare(`UPDATE monitor_targets SET ${sets.join(",")} WHERE id = ?`).run(...params);
  return getTarget(id);
}

export async function deleteTarget(id: string): Promise<void> {
  getDb().prepare("DELETE FROM monitor_targets WHERE id = ?").run(id);
}
