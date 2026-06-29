"use server";
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { requireAppUser } from "@/lib/admin/auth";
import { isAdminUser } from "@/lib/admin/permissions";
import { createTask, updateTask, deleteTask } from "@/lib/db/monitor-tasks";
import { parseTaskConfig } from "./form-utils";
import type { CollectorType } from "@/lib/types/monitor";

async function ensureAdmin() {
  const user = await requireAppUser();
  if (!isAdminUser(user)) redirect("/admin");
}
function str(fd: FormData, k: string): string { return (fd.get(k)?.toString() ?? "").trim(); }
function bool(fd: FormData, k: string): boolean { const v = fd.get(k); return v === "on" || v === "true"; }

export async function createTaskAction(formData: FormData): Promise<void> {
  await ensureAdmin();
  await createTask({
    target_id: str(formData, "target_id"),
    name: str(formData, "name"),
    collector_type: str(formData, "collector_type") as CollectorType,
    config: parseTaskConfig(formData),
    interval_seconds: Number(formData.get("interval_seconds") ?? 300),
    enabled: bool(formData, "enabled"),
    is_maintenance: bool(formData, "is_maintenance"),
  });
  revalidatePath("/admin/monitor-tasks");
  redirect("/admin/monitor-tasks");
}

export async function updateTaskAction(formData: FormData): Promise<void> {
  await ensureAdmin();
  await updateTask(str(formData, "id"), {
    name: str(formData, "name"),
    collector_type: str(formData, "collector_type") as CollectorType,
    config: parseTaskConfig(formData),
    interval_seconds: Number(formData.get("interval_seconds") ?? 300),
    enabled: bool(formData, "enabled"),
    is_maintenance: bool(formData, "is_maintenance"),
  });
  revalidatePath("/admin/monitor-tasks");
  redirect("/admin/monitor-tasks");
}

export async function deleteTaskAction(formData: FormData): Promise<void> {
  await ensureAdmin();
  await deleteTask(str(formData, "id"));
  revalidatePath("/admin/monitor-tasks");
  redirect("/admin/monitor-tasks");
}
