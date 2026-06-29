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
import { listTargets } from "@/lib/db/targets"
import { createTaskAction } from "@/app/admin/(protected)/monitor-tasks/actions"

function getParam(value: string | string[] | undefined) {
  return Array.isArray(value) ? value[0] : value
}

export default async function NewMonitorTaskPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>
}) {
  const user = await requireAppUser()
  if (!isAdminUser(user)) redirect("/admin")

  const params = await searchParams
  const error = getParam(params.error)

  const targets = await listTargets()

  return (
    <div className="space-y-6">
      <PageHeader
        title="新增监控任务"
        description="配置采集类型与执行周期。"
        actions={<Button variant="outline" render={<Link href="/admin/monitor-tasks" />}>返回列表</Button>}
      />
      {error ? <Notice variant="warning" title="保存失败" description={error} /> : null}
      <Card>
        <CardHeader>
          <CardTitle>任务配置</CardTitle>
          <CardDescription>供应商目标仅支持 active_probe 采集类型。</CardDescription>
        </CardHeader>
        <CardContent>
          <form action={createTaskAction} className="grid gap-4 md:grid-cols-2">
            <div className="space-y-2">
              <Label htmlFor="target_id">监控目标</Label>
              <select id="target_id" name="target_id" className={nativeSelectClassName} required>
                <option value="">选择目标</option>
                {targets.map((t) => (
                  <option key={t.id} value={t.id}>
                    {t.name}（{t.kind}）
                  </option>
                ))}
              </select>
            </div>
            <div className="space-y-2">
              <Label htmlFor="name">任务名称</Label>
              <Input id="name" name="name" placeholder="例如：每小时采集用量" required />
            </div>
            <div className="space-y-2">
              <Label htmlFor="collector_type">采集类型</Label>
              <select id="collector_type" name="collector_type" className={nativeSelectClassName} defaultValue="active_probe">
                <option value="active_probe">active_probe（主动探测）</option>
                <option value="newapi_usage">newapi_usage（用量）</option>
                <option value="newapi_errors">newapi_errors（错误）</option>
                <option value="newapi_balance">newapi_balance（余额）</option>
                <option value="newapi_cache">newapi_cache（缓存）</option>
              </select>
            </div>
            <div className="space-y-2">
              <Label htmlFor="interval_seconds">执行周期（秒）</Label>
              <Input id="interval_seconds" name="interval_seconds" type="number" min="30" defaultValue="300" required />
            </div>
            <div className="space-y-2">
              <Label htmlFor="model">模型（可选）</Label>
              <Input id="model" name="model" placeholder="例如：gpt-4o-mini" />
            </div>
            <div className="space-y-2">
              <Label htmlFor="format">格式（可选）</Label>
              <Input id="format" name="format" placeholder="例如：openai" />
            </div>
            <div className="space-y-2 md:col-span-2">
              <Label htmlFor="endpoint">端点（可选）</Label>
              <Input id="endpoint" name="endpoint" placeholder="覆盖默认端点（可选）" />
            </div>
            <div className="flex items-center gap-6 pt-6 text-sm md:col-span-2">
              <label className="flex items-center gap-2">
                <input type="checkbox" name="enabled" defaultChecked />
                启用任务
              </label>
              <label className="flex items-center gap-2">
                <input type="checkbox" name="is_maintenance" />
                维护模式
              </label>
            </div>
            <div className="flex justify-end gap-2 md:col-span-2">
              <Button type="button" variant="outline" render={<Link href="/admin/monitor-tasks" />}>取消</Button>
              <Button type="submit">创建任务</Button>
            </div>
          </form>
        </CardContent>
      </Card>
    </div>
  )
}
