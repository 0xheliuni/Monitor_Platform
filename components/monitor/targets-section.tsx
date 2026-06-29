"use client"

import { useEffect, useState } from "react"
import Link from "next/link"

type TargetOverview = {
  id: string
  name: string
  kind: string
  group_name: string | null
  enabled: boolean
  reachable: number | null
  ttft_ms: number | null
  error_count: number | null
}

export function TargetsSection() {
  const [targets, setTargets] = useState<TargetOverview[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  async function fetchTargets() {
    try {
      const res = await fetch("/api/monitor/targets", { cache: "no-store" })
      if (!res.ok) throw new Error(`HTTP ${res.status}`)
      const data = await res.json() as TargetOverview[]
      setTargets(data)
      setError(null)
    } catch (err) {
      setError(err instanceof Error ? err.message : "获取数据失败")
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    fetchTargets()
    const timer = setInterval(fetchTargets, 15_000)
    return () => clearInterval(timer)
  }, [])

  if (loading) {
    return (
      <section className="space-y-4">
        <h2 className="text-lg font-semibold">监控目标</h2>
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
          {[...Array(4)].map((_, i) => (
            <div key={i} className="animate-pulse rounded-lg border bg-muted/30 p-4 h-24" />
          ))}
        </div>
      </section>
    )
  }

  if (error) {
    return (
      <section className="space-y-4">
        <h2 className="text-lg font-semibold">监控目标</h2>
        <p className="text-sm text-muted-foreground">无法加载监控数据：{error}</p>
      </section>
    )
  }

  if (targets.length === 0) return null

  return (
    <section className="space-y-4">
      <h2 className="text-lg font-semibold">监控目标</h2>
      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
        {targets.map((t) => (
          <Link
            key={t.id}
            href={`/api/monitor/targets/${t.id}`}
            target="_blank"
            rel="noopener noreferrer"
            className="rounded-lg border bg-card p-4 transition-colors hover:bg-muted/50"
          >
            <div className="flex items-start justify-between gap-2">
              <span className="font-medium text-sm leading-tight line-clamp-2">{t.name}</span>
              <span
                className={`mt-0.5 size-2.5 shrink-0 rounded-full ${
                  t.reachable === 1
                    ? "bg-green-500"
                    : t.reachable === 0
                    ? "bg-red-500"
                    : "bg-gray-300 dark:bg-gray-600"
                }`}
                title={t.reachable === 1 ? "可达" : t.reachable === 0 ? "不可达" : "未知"}
              />
            </div>
            <div className="mt-2 flex flex-wrap gap-x-3 gap-y-1 text-xs text-muted-foreground">
              {t.ttft_ms !== null ? (
                <span>TTFT: {t.ttft_ms} ms</span>
              ) : null}
              {t.error_count !== null ? (
                <span>错误: {t.error_count}</span>
              ) : null}
              {t.group_name ? (
                <span className="truncate">{t.group_name}</span>
              ) : null}
            </div>
          </Link>
        ))}
      </div>
    </section>
  )
}
