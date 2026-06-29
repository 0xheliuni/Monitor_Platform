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
import { listRules } from "@/lib/db/alert-rules"
import { deleteRuleAction } from "./actions"

function getParam(value: string | string[] | undefined) {
  return Array.isArray(value) ? value[0] : value
}

export default async function AlertsPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>
}) {
  const user = await requireAppUser()
  if (!isAdminUser(user)) redirect("/admin")

  const params = await searchParams
  const success = getParam(params.success)
  const error = getParam(params.error)

  const rules = await listRules()

  return (
    <div className="space-y-6">
      <PageHeader
        title="告警规则"
        description="阈值规则与飞书路由配置。"
        actions={
          <Button render={<Link href="/admin/alerts/new" />}>
            <PlusIcon />
            新增规则
          </Button>
        }
      />
      {success ? <Notice variant="success" title="操作成功" description={success} /> : null}
      {error ? <Notice variant="warning" title="操作失败" description={error} /> : null}
      <Card>
        <CardHeader>
          <CardTitle>规则列表</CardTitle>
          <CardDescription>共 {rules.length} 条。</CardDescription>
        </CardHeader>
        <CardContent>
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b text-left text-muted-foreground">
                  <th className="pb-2 pr-4 font-medium">名称</th>
                  <th className="pb-2 pr-4 font-medium">指标</th>
                  <th className="pb-2 pr-4 font-medium">条件</th>
                  <th className="pb-2 pr-4 font-medium">阈值</th>
                  <th className="pb-2 pr-4 font-medium">窗口(秒)</th>
                  <th className="pb-2 pr-4 font-medium">严重度</th>
                  <th className="pb-2 pr-4 font-medium">状态</th>
                  <th className="pb-2 font-medium">操作</th>
                </tr>
              </thead>
              <tbody>
                {rules.map((r) => (
                  <tr key={r.id} className="border-b last:border-0">
                    <td className="py-3 pr-4 font-medium">{r.name}</td>
                    <td className="py-3 pr-4 font-mono text-xs text-muted-foreground">{r.metric}</td>
                    <td className="py-3 pr-4 font-mono text-xs">{r.aggregation} {r.comparator}</td>
                    <td className="py-3 pr-4 text-muted-foreground">{r.threshold}</td>
                    <td className="py-3 pr-4 text-muted-foreground">{r.window_seconds}</td>
                    <td className="py-3 pr-4">
                      <span className={`inline-flex items-center rounded-full px-2 py-0.5 text-xs font-medium ${
                        r.severity === "critical"
                          ? "bg-red-100 text-red-800 dark:bg-red-900/30 dark:text-red-400"
                          : r.severity === "warning"
                          ? "bg-yellow-100 text-yellow-800 dark:bg-yellow-900/30 dark:text-yellow-400"
                          : "bg-blue-100 text-blue-800 dark:bg-blue-900/30 dark:text-blue-400"
                      }`}>
                        {r.severity}
                      </span>
                    </td>
                    <td className="py-3 pr-4">
                      <span className={`inline-flex items-center rounded-full px-2 py-0.5 text-xs font-medium ${r.enabled ? "bg-green-100 text-green-800 dark:bg-green-900/30 dark:text-green-400" : "bg-gray-100 text-gray-600 dark:bg-gray-800 dark:text-gray-400"}`}>
                        {r.enabled ? "启用" : "停用"}
                      </span>
                    </td>
                    <td className="py-3">
                      <div className="flex items-center gap-2">
                        <Button variant="outline" size="sm" render={<Link href={`/admin/alerts/${r.id}`} />}>
                          编辑
                        </Button>
                        <form action={deleteRuleAction}>
                          <input type="hidden" name="id" value={r.id} />
                          <Button type="submit" variant="destructive" size="sm">删除</Button>
                        </form>
                      </div>
                    </td>
                  </tr>
                ))}
                {rules.length === 0 ? (
                  <tr>
                    <td colSpan={8} className="py-8 text-center text-muted-foreground">暂无告警规则，点击右上角新增。</td>
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
