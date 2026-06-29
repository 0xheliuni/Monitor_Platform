"use server";
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { requireAppUser } from "@/lib/admin/auth";
import { isAdminUser } from "@/lib/admin/permissions";
import { createWebhook, updateWebhook, deleteWebhook, getWebhook } from "@/lib/db/feishu";
import { buildAlertCard, sendFeishu } from "@/lib/alerting/feishu-card";

async function ensureAdmin() {
  const user = await requireAppUser();
  if (!isAdminUser(user)) redirect("/admin");
}
function str(fd: FormData, k: string): string { return (fd.get(k)?.toString() ?? "").trim(); }
function optStr(fd: FormData, k: string): string | null { const v = str(fd, k); return v.length ? v : null; }

export async function createWebhookAction(formData: FormData): Promise<void> {
  await ensureAdmin();
  await createWebhook({
    name: str(formData, "name"),
    webhook_url: str(formData, "webhook_url"),
    secret: optStr(formData, "secret"),
    group_name: optStr(formData, "group_name"),
  });
  revalidatePath("/admin/webhooks");
  redirect("/admin/webhooks");
}

export async function updateWebhookAction(formData: FormData): Promise<void> {
  await ensureAdmin();
  await updateWebhook(str(formData, "id"), {
    name: str(formData, "name"),
    webhook_url: str(formData, "webhook_url"),
    secret: optStr(formData, "secret"),
    group_name: optStr(formData, "group_name"),
  });
  revalidatePath("/admin/webhooks");
  redirect("/admin/webhooks");
}

export async function deleteWebhookAction(formData: FormData): Promise<void> {
  await ensureAdmin();
  await deleteWebhook(str(formData, "id"));
  revalidatePath("/admin/webhooks");
  redirect("/admin/webhooks");
}

export async function testWebhookAction(formData: FormData): Promise<void> {
  await ensureAdmin();
  const webhook = await getWebhook(str(formData, "id"));
  if (!webhook) redirect("/admin/webhooks?error=webhook 不存在");
  let ok = false; let message = "";
  try {
    await sendFeishu(webhook!, buildAlertCard({
      state: "firing", severity: "info", ruleName: "测试通知", targetName: "（测试）",
      metric: "test", currentValue: 1, comparator: ">", threshold: 0, windowSeconds: 0, firstSeenAt: new Date().toISOString(),
    }));
    ok = true;
  } catch (err) { message = err instanceof Error ? err.message : String(err); }
  redirect(`/admin/webhooks?${ok ? "success=测试已发送" : `error=${encodeURIComponent("发送失败：" + message)}`}`);
}
