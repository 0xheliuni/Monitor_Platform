import Link from "next/link"
import { PlusIcon } from "lucide-react"
import { redirect } from "next/navigation"

import { Notice } from "@/components/admin/notice"
import { PageHeader } from "@/components/admin/page-header"
import { Button } from "@/components/ui/button"
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card"
import { requireAppUser } from "@/lib/admin/auth"
import { isAdminUser } from "@/lib/admin/permissions"
import { listTasks } from "@/lib/db/monitor-tasks"
import { listTargets } from "@/lib/db/targets"
import { deleteTaskAction } from "./actions"

function getParam(value: string | string[] | undefined) {
  return Array.isArray(value) ? value[0] : value
}

export default async function MonitorTasksPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>
}) {
  const user = await requireAppUser()
  if (!isAdminUser(user)) redirect("/admin")

  const params = await searchParams
  const success = getParam(params.success)
  const error = getParam(params.error)

  const [tasks, targets] = await Promise.all([listTasks(), listTargets()])
  const targetMap = new Map(targets.map((t) => [t.id, t.name]))

  return (
    <div className="space-y-6">
      <PageHeader
        title="监控任务"
        description="配置采集任务与执行周期。"
        actions={
          <Button render={<Link href="/admin/monitor-tasks/new" />}>
            <PlusIcon />
            新增任务
          </Button>
        }
      />
      {success ? <Notice variant="success" title="操作成功" description={success} /> : null}
      {error ? <Notice variant="warning" title="操作失败" description={error} /> : null}
      <Card>
        <CardHeader>
          <CardTitle>任务列表</CardTitle>
          <CardDescription>共 {tasks.length} 条。</CardDescription>
        </CardHeader>
        <CardContent>
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b text-left text-muted-foreground">
                  <th className="pb-2 pr-4 font-medium">名称</th>
                  <th className="pb-2 pr-4 font-medium">目标</th>
                  <th className="pb-2 pr-4 font-medium">采集类型</th>
                  <th className="pb-2 pr-4 font-medium">周期(秒)</th>
                  <th className="pb-2 pr-4 font-medium">上次状态</th>
                  <th className="pb-2 pr-4 font-medium">上次错误</th>
                  <th className="pb-2 font-medium">操作</th>
                </tr>
              </thead>
              <tbody>
                {tasks.map((t) => (
                  <tr key={t.id} className="border-b last:border-0">
                    <td className="py-3 pr-4 font-medium">{t.name}</td>
                    <td className="py-3 pr-4 text-muted-foreground">{targetMap.get(t.target_id) ?? t.target_id}</td>
                    <td className="py-3 pr-4 text-muted-foreground font-mono text-xs">{t.collector_type}</td>
                    <td className="py-3 pr-4 text-muted-foreground">{t.interval_seconds}</td>
                    <td className="py-3 pr-4">
                      {t.last_status ? (
                        <span className={`inline-flex items-center rounded-full px-2 py-0.5 text-xs font-medium ${
                          t.last_status === "ok"
                            ? "bg-green-100 text-green-800 dark:bg-green-900/30 dark:text-green-400"
                            : t.last_status === "failed"
                            ? "bg-red-100 text-red-800 dark:bg-red-900/30 dark:text-red-400"
                            : "bg-gray-100 text-gray-600 dark:bg-gray-800 dark:text-gray-400"
                        }`}>
                          {t.last_status}
                        </span>
                      ) : (
                        <span className="text-muted-foreground">-</span>
                      )}
                    </td>
                    <td className="py-3 pr-4 max-w-[200px] truncate text-muted-foreground text-xs">
                      {t.last_error ?? "-"}
                    </td>
                    <td className="py-3">
                      <div className="flex items-center gap-2">
                        <Button variant="outline" size="sm" render={<Link href={`/admin/monitor-tasks/${t.id}`} />}>编辑</Button>
                        <form action={deleteTaskAction}>
                          <input type="hidden" name="id" value={t.id} />
                          <Button type="submit" variant="destructive" size="sm">删除</Button>
                        </form>
                      </div>
                    </td>
                  </tr>
                ))}
                {tasks.length === 0 ? (
                  <tr>
                    <td colSpan={7} className="py-8 text-center text-muted-foreground">暂无监控任务，点击右上角新增。</td>
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
