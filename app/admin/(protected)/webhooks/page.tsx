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
import { listWebhooks } from "@/lib/db/feishu"
import { deleteWebhookAction, testWebhookAction } from "./actions"

function getParam(value: string | string[] | undefined) {
  return Array.isArray(value) ? value[0] : value
}

export default async function WebhooksPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>
}) {
  const user = await requireAppUser()
  if (!isAdminUser(user)) redirect("/admin")

  const params = await searchParams
  const success = getParam(params.success)
  const error = getParam(params.error)

  const webhooks = await listWebhooks()

  return (
    <div className="space-y-6">
      <PageHeader
        title="飞书 Webhook"
        description="告警通知机器人配置。"
        actions={
          <Button render={<Link href="/admin/webhooks/new" />}>
            <PlusIcon />
            新增 Webhook
          </Button>
        }
      />
      {success ? <Notice variant="success" title="操作成功" description={success} /> : null}
      {error ? <Notice variant="warning" title="操作失败" description={error} /> : null}
      <Card>
        <CardHeader>
          <CardTitle>Webhook 列表</CardTitle>
          <CardDescription>共 {webhooks.length} 条。</CardDescription>
        </CardHeader>
        <CardContent>
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b text-left text-muted-foreground">
                  <th className="pb-2 pr-4 font-medium">名称</th>
                  <th className="pb-2 pr-4 font-medium">Webhook URL</th>
                  <th className="pb-2 pr-4 font-medium">分组</th>
                  <th className="pb-2 font-medium">操作</th>
                </tr>
              </thead>
              <tbody>
                {webhooks.map((w) => (
                  <tr key={w.id} className="border-b last:border-0">
                    <td className="py-3 pr-4 font-medium">{w.name}</td>
                    <td className="py-3 pr-4 font-mono text-xs text-muted-foreground max-w-[280px] truncate">
                      {w.webhook_url.replace(/\/([^/]{8})[^/]*$/, "/$1****")}
                    </td>
                    <td className="py-3 pr-4 text-muted-foreground">{w.group_name ?? "-"}</td>
                    <td className="py-3">
                      <div className="flex items-center gap-2">
                        <form action={testWebhookAction}>
                          <input type="hidden" name="id" value={w.id} />
                          <Button type="submit" variant="outline" size="sm">发送测试</Button>
                        </form>
                        <Button variant="outline" size="sm" render={<Link href={`/admin/webhooks/${w.id}`} />}>
                          编辑
                        </Button>
                        <form action={deleteWebhookAction}>
                          <input type="hidden" name="id" value={w.id} />
                          <Button type="submit" variant="destructive" size="sm">删除</Button>
                        </form>
                      </div>
                    </td>
                  </tr>
                ))}
                {webhooks.length === 0 ? (
                  <tr>
                    <td colSpan={4} className="py-8 text-center text-muted-foreground">暂无 Webhook，点击右上角新增。</td>
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
