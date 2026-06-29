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
import { getRule } from "@/lib/db/alert-rules"
import { listTargets } from "@/lib/db/targets"
import { listTasks } from "@/lib/db/monitor-tasks"
import { listWebhooks } from "@/lib/db/feishu"
import { updateRuleAction, deleteRuleAction } from "@/app/admin/(protected)/alerts/actions"

function getParam(value: string | string[] | undefined) {
  return Array.isArray(value) ? value[0] : value
}

export default async function EditAlertRulePage({
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

  const [rule, targets, tasks, webhooks] = await Promise.all([
    getRule(id), listTargets(), listTasks(), listWebhooks(),
  ])
  if (!rule) notFound()

  return (
    <div className="space-y-6">
      <PageHeader
        title={`编辑规则：${rule.name}`}
        description={`创建于 ${formatDateTime(rule.created_at)}，更新于 ${formatDateTime(rule.updated_at)}`}
        actions={<Button variant="outline" render={<Link href="/admin/alerts" />}>返回列表</Button>}
      />
      {success ? <Notice variant="success" title="保存成功" description={success} /> : null}
      {error ? <Notice variant="warning" title="保存失败" description={error} /> : null}
      <Card>
        <CardHeader>
          <CardTitle>编辑规则</CardTitle>
          <CardDescription>修改告警触发条件与通知路由。</CardDescription>
        </CardHeader>
        <CardContent>
          <form action={updateRuleAction} className="grid gap-4 md:grid-cols-2">
            <input type="hidden" name="id" value={rule.id} />
            <div className="space-y-2 md:col-span-2">
              <Label htmlFor="name">规则名称</Label>
              <Input id="name" name="name" defaultValue={rule.name} required />
            </div>
            <div className="space-y-2">
              <Label htmlFor="target_id">监控目标（可选）</Label>
              <select id="target_id" name="target_id" className={nativeSelectClassName} defaultValue={rule.target_id ?? ""}>
                <option value="">不限目标</option>
                {targets.map((t) => (
                  <option key={t.id} value={t.id}>{t.name}</option>
                ))}
              </select>
            </div>
            <div className="space-y-2">
              <Label htmlFor="task_id">监控任务（可选）</Label>
              <select id="task_id" name="task_id" className={nativeSelectClassName} defaultValue={rule.task_id ?? ""}>
                <option value="">不限任务</option>
                {tasks.map((t) => (
                  <option key={t.id} value={t.id}>{t.name}</option>
                ))}
              </select>
            </div>
            <div className="space-y-2">
              <Label htmlFor="metric">指标</Label>
              <select id="metric" name="metric" className={nativeSelectClassName} defaultValue={rule.metric}>
                <option value="ttft_ms">ttft_ms（首 token 延迟）</option>
                <option value="ping_ms">ping_ms（Ping 延迟）</option>
                <option value="reachable">reachable（可达性）</option>
                <option value="usage_quota">usage_quota（用量配额）</option>
                <option value="usage_tokens">usage_tokens（Token 用量）</option>
                <option value="request_count">request_count（请求数）</option>
                <option value="error_count">error_count（错误数）</option>
                <option value="channel_balance">channel_balance（渠道余额）</option>
                <option value="cache_entries">cache_entries（缓存条目）</option>
              </select>
            </div>
            <div className="space-y-2">
              <Label htmlFor="aggregation">聚合方式</Label>
              <select id="aggregation" name="aggregation" className={nativeSelectClassName} defaultValue={rule.aggregation}>
                <option value="avg">avg（均值）</option>
                <option value="sum">sum（求和）</option>
                <option value="max">max（最大值）</option>
                <option value="min">min（最小值）</option>
                <option value="count">count（计数）</option>
                <option value="last">last（最新值）</option>
              </select>
            </div>
            <div className="space-y-2">
              <Label htmlFor="comparator">比较符</Label>
              <select id="comparator" name="comparator" className={nativeSelectClassName} defaultValue={rule.comparator}>
                <option value=">">&gt;（大于）</option>
                <option value=">=">&gt;=（大于等于）</option>
                <option value="<">&lt;（小于）</option>
                <option value="<=">&lt;=（小于等于）</option>
                <option value="==">==（等于）</option>
              </select>
            </div>
            <div className="space-y-2">
              <Label htmlFor="threshold">阈值</Label>
              <Input id="threshold" name="threshold" type="number" step="any" defaultValue={String(rule.threshold)} required />
            </div>
            <div className="space-y-2">
              <Label htmlFor="window_seconds">窗口（秒）</Label>
              <Input id="window_seconds" name="window_seconds" type="number" min="60" defaultValue={String(rule.window_seconds)} required />
            </div>
            <div className="space-y-2">
              <Label htmlFor="consecutive_breaches">连续触发次数</Label>
              <Input id="consecutive_breaches" name="consecutive_breaches" type="number" min="1" defaultValue={String(rule.consecutive_breaches)} required />
            </div>
            <div className="space-y-2">
              <Label htmlFor="severity">严重度</Label>
              <select id="severity" name="severity" className={nativeSelectClassName} defaultValue={rule.severity}>
                <option value="info">info</option>
                <option value="warning">warning</option>
                <option value="critical">critical</option>
              </select>
            </div>
            <div className="space-y-2">
              <Label htmlFor="feishu_webhook_id">飞书 Webhook（可选）</Label>
              <select id="feishu_webhook_id" name="feishu_webhook_id" className={nativeSelectClassName} defaultValue={rule.feishu_webhook_id ?? ""}>
                <option value="">不发送通知</option>
                {webhooks.map((w) => (
                  <option key={w.id} value={w.id}>{w.name}</option>
                ))}
              </select>
            </div>
            <div className="flex items-center gap-6 pt-6 text-sm md:col-span-2">
              <label className="flex items-center gap-2">
                <input type="checkbox" name="enabled" defaultChecked={rule.enabled} />
                启用规则
              </label>
            </div>
            <div className="flex items-center gap-3 md:col-span-2">
              <Button type="submit">保存更改</Button>
              <Button variant="outline" render={<Link href="/admin/alerts" />}>取消</Button>
            </div>
          </form>
          <form action={deleteRuleAction} className="mt-6 border-t pt-6">
            <input type="hidden" name="id" value={rule.id} />
            <Button type="submit" variant="destructive">删除规则</Button>
          </form>
        </CardContent>
      </Card>
    </div>
  )
}
