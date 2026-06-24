import "server-only";
import { listActiveNotifications } from "@/lib/db/notifications";
import { SystemNotificationRow } from "@/lib/types/database";

/**
 * 服务端获取所有活跃的系统通知
 */
export async function getActiveSystemNotifications(): Promise<SystemNotificationRow[]> {
  try {
    const rows = await listActiveNotifications();
    return rows as SystemNotificationRow[];
  } catch (error) {
    console.error("Failed to fetch system notifications:", error);
    return [];
  }
}
