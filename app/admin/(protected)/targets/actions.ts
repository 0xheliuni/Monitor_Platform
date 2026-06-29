"use server";
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { requireAppUser } from "@/lib/admin/auth";
import { isAdminUser } from "@/lib/admin/permissions";
import { createTarget, updateTarget, deleteTarget, getTarget } from "@/lib/db/targets";
import { newapiGet } from "@/lib/collectors/newapi-client";
import { collectProbe } from "@/lib/collectors/active-probe";
import type { TargetKind } from "@/lib/types/monitor";

async function ensureAdmin() {
  const user = await requireAppUser();
  if (!isAdminUser(user)) redirect("/admin");
}

function str(fd: FormData, k: string): string { return (fd.get(k)?.toString() ?? "").trim(); }
function optStr(fd: FormData, k: string): string | null { const v = str(fd, k); return v.length ? v : null; }

export async function createTargetAction(formData: FormData): Promise<void> {
  await ensureAdmin();
  await createTarget({
    name: str(formData, "name"),
    base_url: str(formData, "base_url"),
    kind: (str(formData, "kind") || "self") as TargetKind,
    admin_token: optStr(formData, "admin_token"),
    admin_user_id: optStr(formData, "admin_user_id"),
    probe_api_key: optStr(formData, "probe_api_key"),
    group_name: optStr(formData, "group_name"),
    enabled: formData.get("enabled") === "on" || formData.get("enabled") === "true",
  });
  revalidatePath("/admin/targets");
  redirect("/admin/targets");
}

export async function updateTargetAction(formData: FormData): Promise<void> {
  await ensureAdmin();
  const id = str(formData, "id");
  const patch: Record<string, unknown> = {
    name: str(formData, "name"),
    base_url: str(formData, "base_url"),
    kind: (str(formData, "kind") || "self") as TargetKind,
    admin_user_id: optStr(formData, "admin_user_id"),
    group_name: optStr(formData, "group_name"),
    enabled: formData.get("enabled") === "on" || formData.get("enabled") === "true",
  };
  // 仅当用户填写了新值时才覆盖密钥（留空表示不修改）
  const newToken = optStr(formData, "admin_token");
  if (newToken) patch.admin_token = newToken;
  const newKey = optStr(formData, "probe_api_key");
  if (newKey) patch.probe_api_key = newKey;
  await updateTarget(id, patch as never);
  revalidatePath("/admin/targets");
  redirect("/admin/targets");
}

export async function deleteTargetAction(formData: FormData): Promise<void> {
  await ensureAdmin();
  await deleteTarget(str(formData, "id"));
  revalidatePath("/admin/targets");
  redirect("/admin/targets");
}

export async function testTargetConnectionAction(formData: FormData): Promise<void> {
  await ensureAdmin();
  const id = str(formData, "id");
  const target = await getTarget(id);
  if (!target) redirect("/admin/targets?error=目标不存在");
  let ok = false;
  let message = "";
  try {
    if (target!.kind === "self") {
      await newapiGet(target!, "/api/status");
      ok = true;
    } else {
      const samples = await collectProbe(target!, {
        id: "test", target_id: id, name: "test", collector_type: "active_probe",
        config: {}, interval_seconds: 60, enabled: true, is_maintenance: false,
        next_run_at: null, last_run_at: null, last_status: null, last_error: null,
        created_at: "", updated_at: "",
      });
      ok = samples.some((s) => s.metric === "reachable" && s.value === 1);
    }
  } catch (err) {
    message = err instanceof Error ? err.message : String(err);
  }
  redirect(`/admin/targets?${ok ? "success=连通正常" : `error=${encodeURIComponent("连通失败：" + message)}`}`);
}
