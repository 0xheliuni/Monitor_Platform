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
import { nativeSelectClassName } from "@/lib/admin/forms"
import { createTargetAction } from "@/app/admin/(protected)/targets/actions"

function getParam(value: string | string[] | undefined) {
  return Array.isArray(value) ? value[0] : value
}

export default async function NewTargetPage({
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
        title="新增监控目标"
        description="填写 newapi 实例的连接信息。"
        actions={<Button variant="outline" render={<Link href="/admin/targets" />}>返回列表</Button>}
      />
      {error ? <Notice variant="warning" title="保存失败" description={error} /> : null}
      <Card>
        <CardHeader>
          <CardTitle>目标信息</CardTitle>
          <CardDescription>自有实例支持拉取聚合指标；供应商实例仅支持主动探测。</CardDescription>
        </CardHeader>
        <CardContent>
          <form action={createTargetAction} className="grid gap-4 md:grid-cols-2">
            <div className="space-y-2">
              <Label htmlFor="name">名称</Label>
              <Input id="name" name="name" placeholder="生产环境 newapi" required />
            </div>
            <div className="space-y-2">
              <Label htmlFor="kind">类型</Label>
              <select id="kind" name="kind" className={nativeSelectClassName} defaultValue="self">
                <option value="self">自有（self）</option>
                <option value="supplier">供应商（supplier）</option>
              </select>
            </div>
            <div className="space-y-2 md:col-span-2">
              <Label htmlFor="base_url">Base URL</Label>
              <Input id="base_url" name="base_url" placeholder="https://api.example.com" required />
            </div>
            <div className="space-y-2">
              <Label htmlFor="admin_token">Admin Token</Label>
              <Input id="admin_token" name="admin_token" type="password" placeholder="管理员令牌（可选）" />
            </div>
            <div className="space-y-2">
              <Label htmlFor="admin_user_id">Admin User ID</Label>
              <Input id="admin_user_id" name="admin_user_id" placeholder="管理员用户 ID（可选）" />
            </div>
            <div className="space-y-2">
              <Label htmlFor="probe_api_key">Probe API Key</Label>
              <Input id="probe_api_key" name="probe_api_key" type="password" placeholder="主动探测用 API Key（可选）" />
            </div>
            <div className="space-y-2">
              <Label htmlFor="group_name">分组</Label>
              <Input id="group_name" name="group_name" placeholder="可选分组名称" />
            </div>
            <div className="flex items-center gap-6 pt-6 text-sm md:col-span-2">
              <label className="flex items-center gap-2">
                <input type="checkbox" name="enabled" defaultChecked />
                启用监控
              </label>
            </div>
            <div className="flex justify-end gap-2 md:col-span-2">
              <Button type="button" variant="outline" render={<Link href="/admin/targets" />}>取消</Button>
              <Button type="submit">创建目标</Button>
            </div>
          </form>
        </CardContent>
      </Card>
    </div>
  )
}
