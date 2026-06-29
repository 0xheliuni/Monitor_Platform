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
import { listTargets } from "@/lib/db/targets"
import { maskSecret } from "@/lib/db/monitor-crypto"
import { deleteTargetAction, testTargetConnectionAction } from "./actions"

function getParam(value: string | string[] | undefined) {
  return Array.isArray(value) ? value[0] : value
}

export default async function TargetsPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>
}) {
  const user = await requireAppUser()
  if (!isAdminUser(user)) redirect("/admin")
  const params = await searchParams
  const success = getParam(params.success)
  const error = getParam(params.error)

  const targets = await listTargets()

  return (
    <div className="space-y-6">
      <PageHeader
        title="监控目标"
        description="管理被监控的 newapi 实例（自有 / 供应商）。"
        actions={
          <Button render={<Link href="/admin/targets/new" />}>
            <PlusIcon />
            新增目标
          </Button>
        }
      />
      {success ? <Notice variant="success" title="操作成功" description={success} /> : null}
      {error ? <Notice variant="warning" title="操作失败" description={error} /> : null}
      <Card>
        <CardHeader>
          <CardTitle>目标列表</CardTitle>
          <CardDescription>共 {targets.length} 条。</CardDescription>
        </CardHeader>
        <CardContent>
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b text-left text-muted-foreground">
                  <th className="pb-2 pr-4 font-medium">名称</th>
                  <th className="pb-2 pr-4 font-medium">类型</th>
                  <th className="pb-2 pr-4 font-medium">Base URL</th>
                  <th className="pb-2 pr-4 font-medium">Admin Token</th>
                  <th className="pb-2 pr-4 font-medium">分组</th>
                  <th className="pb-2 pr-4 font-medium">状态</th>
                  <th className="pb-2 font-medium">操作</th>
                </tr>
              </thead>
              <tbody>
                {targets.map((t) => (
                  <tr key={t.id} className="border-b last:border-0">
                    <td className="py-3 pr-4 font-medium">{t.name}</td>
                    <td className="py-3 pr-4 text-muted-foreground">{t.kind}</td>
                    <td className="py-3 pr-4 font-mono text-xs text-muted-foreground max-w-[200px] truncate">{t.base_url}</td>
                    <td className="py-3 pr-4 font-mono text-xs text-muted-foreground">{maskSecret(t.admin_token)}</td>
                    <td className="py-3 pr-4 text-muted-foreground">{t.group_name ?? "-"}</td>
                    <td className="py-3 pr-4">
                      <span className={`inline-flex items-center rounded-full px-2 py-0.5 text-xs font-medium ${t.enabled ? "bg-green-100 text-green-800 dark:bg-green-900/30 dark:text-green-400" : "bg-gray-100 text-gray-600 dark:bg-gray-800 dark:text-gray-400"}`}>
                        {t.enabled ? "启用" : "停用"}
                      </span>
                    </td>
                    <td className="py-3">
                      <div className="flex items-center gap-2">
                        <form action={testTargetConnectionAction}>
                          <input type="hidden" name="id" value={t.id} />
                          <Button type="submit" variant="outline" size="sm">测试连通</Button>
                        </form>
                        <Button variant="outline" size="sm" render={<Link href={`/admin/targets/${t.id}`} />}>
                          编辑
                        </Button>
                        <form action={deleteTargetAction}>
                          <input type="hidden" name="id" value={t.id} />
                          <Button type="submit" variant="destructive" size="sm">删除</Button>
                        </form>
                      </div>
                    </td>
                  </tr>
                ))}
                {targets.length === 0 ? (
                  <tr>
                    <td colSpan={7} className="py-8 text-center text-muted-foreground">暂无监控目标，点击右上角新增。</td>
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
