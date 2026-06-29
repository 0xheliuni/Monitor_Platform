"use server";
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { requireAppUser } from "@/lib/admin/auth";
import { isAdminUser } from "@/lib/admin/permissions";
import { createRule, updateRule, deleteRule } from "@/lib/db/alert-rules";
import { parseRuleNumbers } from "../monitor-tasks/form-utils";
import type { MetricName, Comparator, Aggregation, AlertSeverity } from "@/lib/types/monitor";

async function ensureAdmin() {
  const user = await requireAppUser();
  if (!isAdminUser(user)) redirect("/admin");
}
function str(fd: FormData, k: string): string { return (fd.get(k)?.toString() ?? "").trim(); }
function optStr(fd: FormData, k: string): string | null { const v = str(fd, k); return v.length ? v : null; }
function bool(fd: FormData, k: string): boolean { const v = fd.get(k); return v === "on" || v === "true"; }

function buildRuleInput(fd: FormData) {
  const nums = parseRuleNumbers(fd);
  return {
    name: str(fd, "name"),
    target_id: optStr(fd, "target_id"),
    task_id: optStr(fd, "task_id"),
    metric: str(fd, "metric") as MetricName,
    comparator: str(fd, "comparator") as Comparator,
    threshold: nums.threshold,
    window_seconds: nums.window_seconds,
    aggregation: str(fd, "aggregation") as Aggregation,
    consecutive_breaches: nums.consecutive_breaches,
    severity: (str(fd, "severity") || "warning") as AlertSeverity,
    feishu_webhook_id: optStr(fd, "feishu_webhook_id"),
    enabled: bool(fd, "enabled"),
  };
}

export async function createRuleAction(formData: FormData): Promise<void> {
  await ensureAdmin();
  await createRule(buildRuleInput(formData));
  revalidatePath("/admin/alerts");
  redirect("/admin/alerts");
}

export async function updateRuleAction(formData: FormData): Promise<void> {
  await ensureAdmin();
  await updateRule(str(formData, "id"), buildRuleInput(formData));
  revalidatePath("/admin/alerts");
  redirect("/admin/alerts");
}

export async function deleteRuleAction(formData: FormData): Promise<void> {
  await ensureAdmin();
  await deleteRule(str(formData, "id"));
  revalidatePath("/admin/alerts");
  redirect("/admin/alerts");
}
