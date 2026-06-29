import Link from "next/link"
import { redirect } from "next/navigation"

import { Notice } from "@/components/admin/notice"
import { PageHeader } from "@/components/admin/page-header"
import { Button } from "@/components/ui/button"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { requireAppUser } from "@/lib/admin/auth"
import { isAdminUser } from "@/lib/admin/permissions"
import { createWebhookAction } from "@/app/admin/(protected)/webhooks/actions"

function getParam(value: string | string[] | undefined) {
  return Array.isArray(value) ? value[0] : value
}

export default async function NewWebhookPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>
}) {
  const user = await requireAppUser()
  if (!isAdminUser(user)) redirect("/admin")

  const params = await searchParams
  const error = getParam(params.error)

  return (
    <div className="space-y-6">
      <PageHeader
        title="新增飞书 Webhook"
        description="配置告警通知机器人。"
        actions={<Button variant="outline" render={<Link href="/admin/webhooks" />}>返回列表</Button>}
      />
      {error ? <Notice variant="warning" title="保存失败" description={error} /> : null}
      <Card>
        <CardHeader>
          <CardTitle>Webhook 配置</CardTitle>
          <CardDescription>飞书机器人 Webhook 地址，可通过飞书群机器人设置获取。</CardDescription>
        </CardHeader>
        <CardContent>
          <form action={createWebhookAction} className="grid gap-4 md:grid-cols-2">
            <div className="space-y-2">
              <Label htmlFor="name">名称</Label>
              <Input id="name" name="name" placeholder="例如：告警通知群" required />
            </div>
            <div className="space-y-2">
              <Label htmlFor="group_name">分组（可选）</Label>
              <Input id="group_name" name="group_name" placeholder="关联的目标分组" />
            </div>
            <div className="space-y-2 md:col-span-2">
              <Label htmlFor="webhook_url">Webhook URL</Label>
              <Input id="webhook_url" name="webhook_url" placeholder="https://open.feishu.cn/open-apis/bot/v2/hook/..." required />
            </div>
            <div className="space-y-2 md:col-span-2">
              <Label htmlFor="secret">签名密钥（可选）</Label>
              <Input id="secret" name="secret" type="password" placeholder="飞书机器人签名校验密钥（可选）" />
            </div>
            <div className="flex justify-end gap-2 md:col-span-2">
              <Button type="button" variant="outline" render={<Link href="/admin/webhooks" />}>取消</Button>
              <Button type="submit">创建 Webhook</Button>
            </div>
          </form>
        </CardContent>
      </Card>
    </div>
  )
}
