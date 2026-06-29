import Link from "next/link"
import { notFound, redirect } from "next/navigation"

import { Notice } from "@/components/admin/notice"
import { PageHeader } from "@/components/admin/page-header"
import { Button } from "@/components/ui/button"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { requireAppUser } from "@/lib/admin/auth"
import { isAdminUser } from "@/lib/admin/permissions"
import { formatDateTime } from "@/lib/admin/format"
import { getWebhook } from "@/lib/db/feishu"
import { updateWebhookAction, deleteWebhookAction } from "@/app/admin/(protected)/webhooks/actions"

function getParam(value: string | string[] | undefined) {
  return Array.isArray(value) ? value[0] : value
}

export default async function EditWebhookPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>
  searchParams: Promise<Record<string, string | string[] | undefined>>
}) {
  const user = await requireAppUser()
  if (!isAdminUser(user)) redirect("/admin")

  const { id } = await params
  const query = await searchParams
  const error = getParam(query.error)
  const success = getParam(query.success)

  const webhook = await getWebhook(id)
  if (!webhook) notFound()

  return (
    <div className="space-y-6">
      <PageHeader
        title={`编辑 Webhook：${webhook.name}`}
        description={`创建于 ${formatDateTime(webhook.created_at)}，更新于 ${formatDateTime(webhook.updated_at)}`}
        actions={<Button variant="outline" render={<Link href="/admin/webhooks" />}>返回列表</Button>}
      />
      {success ? <Notice variant="success" title="保存成功" description={success} /> : null}
      {error ? <Notice variant="warning" title="保存失败" description={error} /> : null}
      <Card>
        <CardHeader>
          <CardTitle>编辑 Webhook</CardTitle>
          <CardDescription>签名密钥留空表示不修改已有值。</CardDescription>
        </CardHeader>
        <CardContent>
          <form action={updateWebhookAction} className="grid gap-4 md:grid-cols-2">
            <input type="hidden" name="id" value={webhook.id} />
            <div className="space-y-2">
              <Label htmlFor="name">名称</Label>
              <Input id="name" name="name" defaultValue={webhook.name} required />
            </div>
            <div className="space-y-2">
              <Label htmlFor="group_name">分组（可选）</Label>
              <Input id="group_name" name="group_name" defaultValue={webhook.group_name ?? ""} />
            </div>
            <div className="space-y-2 md:col-span-2">
              <Label htmlFor="webhook_url">Webhook URL</Label>
              <Input id="webhook_url" name="webhook_url" defaultValue={webhook.webhook_url} required />
            </div>
            <div className="space-y-2 md:col-span-2">
              <Label htmlFor="secret">签名密钥（可选）</Label>
              <Input id="secret" name="secret" type="password" placeholder="留空表示不修改" />
            </div>
            <div className="flex items-center gap-3 md:col-span-2">
              <Button type="submit">保存更改</Button>
              <Button variant="outline" render={<Link href="/admin/webhooks" />}>取消</Button>
            </div>
          </form>
          <form action={deleteWebhookAction} className="mt-6 border-t pt-6">
            <input type="hidden" name="id" value={webhook.id} />
            <Button type="submit" variant="destructive">删除 Webhook</Button>
          </form>
        </CardContent>
      </Card>
    </div>
  )
}
