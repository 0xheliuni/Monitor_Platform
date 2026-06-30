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
import { getTask } from "@/lib/db/monitor-tasks"
import { listTargets } from "@/lib/db/targets"
import { updateTaskAction, deleteTaskAction } from "@/app/admin/(protected)/monitor-tasks/actions"

function getParam(value: string | string[] | undefined) {
  return Array.isArray(value) ? value[0] : value
}

function configValue(config: Record<string, unknown> | null, key: string): string {
  const v = config?.[key]
  return typeof v === "string" ? v : ""
}

export default async function EditMonitorTaskPage({
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

  const [task, targets] = await Promise.all([getTask(id), listTargets()])
  if (!task) notFound()

  const targetName = targets.find((t) => t.id === task.target_id)?.name ?? task.target_id

  return (
    <div className="space-y-6">
      <PageHeader
        title={`编辑任务：${task.name}`}
        description={`创建于 ${formatDateTime(task.created_at)}，更新于 ${formatDateTime(task.updated_at)}`}
        actions={<Button variant="outline" render={<Link href="/admin/monitor-tasks" />}>返回列表</Button>}
      />
      {success ? <Notice variant="success" title="保存成功" description={success} /> : null}
      {error ? <Notice variant="warning" title="保存失败" description={error} /> : null}
      <Card>
        <CardHeader>
          <CardTitle>任务配置</CardTitle>
          <CardDescription>修改采集类型与执行周期；目标不可更改。</CardDescription>
        </CardHeader>
        <CardContent>
          <form action={updateTaskAction} className="grid gap-4 md:grid-cols-2">
            <input type="hidden" name="id" value={task.id} />
            <div className="space-y-2">
              <Label htmlFor="target_name">监控目标</Label>
              <Input id="target_name" value={targetName} disabled readOnly />
            </div>
            <div className="space-y-2">
              <Label htmlFor="name">任务名称</Label>
              <Input id="name" name="name" defaultValue={task.name} required />
            </div>
            <div className="space-y-2">
              <Label htmlFor="collector_type">采集类型</Label>
              <select id="collector_type" name="collector_type" className={nativeSelectClassName} defaultValue={task.collector_type}>
                <option value="active_probe">active_probe（主动探测）</option>
                <option value="newapi_usage">newapi_usage（用量）</option>
                <option value="newapi_errors">newapi_errors（错误）</option>
                <option value="newapi_balance">newapi_balance（余额）</option>
                <option value="newapi_cache">newapi_cache（缓存）</option>
              </select>
            </div>
            <div className="space-y-2">
              <Label htmlFor="interval_seconds">执行周期（秒）</Label>
              <Input id="interval_seconds" name="interval_seconds" type="number" min="30" defaultValue={String(task.interval_seconds)} required />
            </div>
            <div className="space-y-2">
              <Label htmlFor="model">模型（可选）</Label>
              <Input id="model" name="model" defaultValue={configValue(task.config, "model")} placeholder="例如：gpt-4o-mini" />
            </div>
            <div className="space-y-2">
              <Label htmlFor="format">格式（可选）</Label>
              <Input id="format" name="format" defaultValue={configValue(task.config, "format")} placeholder="例如：openai" />
            </div>
            <div className="space-y-2 md:col-span-2">
              <Label htmlFor="endpoint">端点（可选）</Label>
              <Input id="endpoint" name="endpoint" defaultValue={configValue(task.config, "endpoint")} placeholder="覆盖默认端点（可选）" />
            </div>
            <div className="flex items-center gap-6 pt-6 text-sm md:col-span-2">
              <label className="flex items-center gap-2">
                <input type="checkbox" name="enabled" defaultChecked={task.enabled} />
                启用任务
              </label>
              <label className="flex items-center gap-2">
                <input type="checkbox" name="is_maintenance" defaultChecked={task.is_maintenance} />
                维护模式
              </label>
            </div>
            <div className="flex items-center gap-3 md:col-span-2">
              <Button type="submit">保存更改</Button>
              <Button variant="outline" render={<Link href="/admin/monitor-tasks" />}>取消</Button>
            </div>
          </form>
          <form action={deleteTaskAction} className="mt-6 border-t pt-6">
            <input type="hidden" name="id" value={task.id} />
            <Button type="submit" variant="destructive">删除任务</Button>
          </form>
        </CardContent>
      </Card>
    </div>
  )
}
