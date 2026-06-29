import { redirect } from "next/navigation"

import { PageHeader } from "@/components/admin/page-header"
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card"
import { requireAppUser } from "@/lib/admin/auth"
import { isAdminUser } from "@/lib/admin/permissions"
import { listRecentEvents } from "@/lib/db/alert-events"
import { formatDateTime } from "@/lib/admin/format"

export default async function AlertEventsPage() {
  const user = await requireAppUser()
  if (!isAdminUser(user)) redirect("/admin")

  const events = await listRecentEvents(100)

  return (
    <div className="space-y-6">
      <PageHeader
        title="告警事件"
        description="最近 100 条告警触发记录（只读时间线）。"
      />
      <Card>
        <CardHeader>
          <CardTitle>事件时间线</CardTitle>
          <CardDescription>共 {events.length} 条最近事件。</CardDescription>
        </CardHeader>
        <CardContent>
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b text-left text-muted-foreground">
                  <th className="pb-2 pr-4 font-medium">规则 ID</th>
                  <th className="pb-2 pr-4 font-medium">状态</th>
                  <th className="pb-2 pr-4 font-medium">触发次数</th>
                  <th className="pb-2 pr-4 font-medium">首次触发</th>
                  <th className="pb-2 pr-4 font-medium">最近触发</th>
                  <th className="pb-2 pr-4 font-medium">恢复时间</th>
                  <th className="pb-2 font-medium">消息</th>
                </tr>
              </thead>
              <tbody>
                {events.map((e) => (
                  <tr key={e.id} className="border-b last:border-0">
                    <td className="py-3 pr-4 font-mono text-xs text-muted-foreground max-w-[140px] truncate">{e.rule_id}</td>
                    <td className="py-3 pr-4">
                      <span className={`inline-flex items-center rounded-full px-2 py-0.5 text-xs font-medium ${
                        e.state === "firing"
                          ? "bg-red-100 text-red-800 dark:bg-red-900/30 dark:text-red-400"
                          : "bg-green-100 text-green-800 dark:bg-green-900/30 dark:text-green-400"
                      }`}>
                        {e.state}
                      </span>
                    </td>
                    <td className="py-3 pr-4 text-muted-foreground">{e.breach_count}</td>
                    <td className="py-3 pr-4 text-muted-foreground text-xs">
                      {e.first_seen_at ? formatDateTime(e.first_seen_at) : "-"}
                    </td>
                    <td className="py-3 pr-4 text-muted-foreground text-xs">
                      {e.last_seen_at ? formatDateTime(e.last_seen_at) : "-"}
                    </td>
                    <td className="py-3 pr-4 text-muted-foreground text-xs">
                      {e.resolved_at ? formatDateTime(e.resolved_at) : "-"}
                    </td>
                    <td className="py-3 text-muted-foreground max-w-[200px] truncate text-xs">
                      {e.message ?? "-"}
                    </td>
                  </tr>
                ))}
                {events.length === 0 ? (
                  <tr>
                    <td colSpan={7} className="py-8 text-center text-muted-foreground">暂无告警事件。</td>
                  </tr>
                ) : null}
              </tbody>
            </table>
          </div>
        </CardContent>
      </Card>
    </div>
  )
}
