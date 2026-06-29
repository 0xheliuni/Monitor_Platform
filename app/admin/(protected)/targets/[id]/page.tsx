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
import { nativeSelectClassName } from "@/lib/admin/forms"
import { formatDateTime } from "@/lib/admin/format"
import { getTarget } from "@/lib/db/targets"
import { updateTargetAction, deleteTargetAction } from "@/app/admin/(protected)/targets/actions"

function getParam(value: string | string[] | undefined) {
  return Array.isArray(value) ? value[0] : value
}

export default async function EditTargetPage({
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

  const target = await getTarget(id)
  if (!target) notFound()

  return (
    <div className="space-y-6">
      <PageHeader
        title={`编辑：${target.name}`}
        description={`创建于 ${formatDateTime(target.created_at)}，更新于 ${formatDateTime(target.updated_at)}`}
        actions={<Button variant="outline" render={<Link href="/admin/targets" />}>返回列表</Button>}
      />
      {success ? <Notice variant="success" title="保存成功" description={success} /> : null}
      {error ? <Notice variant="warning" title="保存失败" description={error} /> : null}
      <Card>
        <CardHeader>
          <CardTitle>编辑目标</CardTitle>
          <CardDescription>密钥字段留空表示不修改已有值。</CardDescription>
        </CardHeader>
        <CardContent>
          <form action={updateTargetAction} className="grid gap-4 md:grid-cols-2">
            <input type="hidden" name="id" value={target.id} />
            <div className="space-y-2">
              <Label htmlFor="name">名称</Label>
              <Input id="name" name="name" defaultValue={target.name} required />
            </div>
            <div className="space-y-2">
              <Label htmlFor="kind">类型</Label>
              <select id="kind" name="kind" className={nativeSelectClassName} defaultValue={target.kind}>
                <option value="self">自有（self）</option>
                <option value="supplier">供应商（supplier）</option>
              </select>
            </div>
            <div className="space-y-2 md:col-span-2">
              <Label htmlFor="base_url">Base URL</Label>
              <Input id="base_url" name="base_url" defaultValue={target.base_url} required />
            </div>
            <div className="space-y-2">
              <Label htmlFor="admin_token">Admin Token</Label>
              <Input id="admin_token" name="admin_token" type="password" placeholder="留空表示不修改" />
            </div>
            <div className="space-y-2">
              <Label htmlFor="admin_user_id">Admin User ID</Label>
              <Input id="admin_user_id" name="admin_user_id" defaultValue={target.admin_user_id ?? ""} />
            </div>
            <div className="space-y-2">
              <Label htmlFor="probe_api_key">Probe API Key</Label>
              <Input id="probe_api_key" name="probe_api_key" type="password" placeholder="留空表示不修改" />
            </div>
            <div className="space-y-2">
              <Label htmlFor="group_name">分组</Label>
              <Input id="group_name" name="group_name" defaultValue={target.group_name ?? ""} />
            </div>
            <div className="flex items-center gap-6 pt-6 text-sm md:col-span-2">
              <label className="flex items-center gap-2">
                <input type="checkbox" name="enabled" defaultChecked={target.enabled} />
                启用监控
              </label>
            </div>
            <div className="flex items-center gap-3 md:col-span-2">
              <Button type="submit">保存更改</Button>
              <Button variant="outline" render={<Link href="/admin/targets" />}>取消</Button>
            </div>
          </form>
          <form action={deleteTargetAction} className="mt-6 border-t pt-6">
            <input type="hidden" name="id" value={target.id} />
            <Button type="submit" variant="destructive">删除目标</Button>
          </form>
        </CardContent>
      </Card>
    </div>
  )
}
