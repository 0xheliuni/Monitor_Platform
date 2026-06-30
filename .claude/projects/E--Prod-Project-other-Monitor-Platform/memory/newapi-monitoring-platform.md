---
name: newapi-monitoring-platform
description: The newapi monitoring subsystem added to Check CX — scope, layout, and known deferred items
metadata:
  type: project
---

A newapi-instance monitoring platform was built on top of the Check CX health monitor (branch `feat/newapi-monitoring-platform`, 24 commits as of 2026-06-29, not yet merged to main). It monitors self-hosted and supplier newapi gateways: usage/model summaries, per-channel TTFT/connectivity/balance/cache, error-count alerting, with a firing/resolved alert state machine and Feishu webhook notifications.

Layout: `lib/collectors/` (newapi-client + 5 collectors: newapi-usage/errors/balance/cache + active-probe, dispatched via `index.ts` REGISTRY with SkipCollector gating supplier+non-probe); `lib/db/` adds 6 tables (monitor_targets, monitor_tasks, metric_samples, alert_rules, alert_events, feishu_webhooks) + `monitor-crypto.ts` (AES-256-GCM, key via HKDF from ADMIN_SESSION_SECRET) + `samples.ts` (aggregateWindow uses AGG_FN allow-list); `lib/alerting/` (engine.ts state machine + feishu-card.ts); `lib/core/monitor-runner.ts` wired into existing `poller.ts` tick; `app/api/monitor/*` public read-only routes; `app/admin/(protected)/{targets,monitor-tasks,alerts,webhooks,alert-events}` admin UI + Server Actions; public `components/monitor/targets-section.tsx`. Secrets encrypted at rest; public API cherry-picks safe fields (no plaintext, meta stripped).

Built via subagent-driven-development (16 plan tasks + 5 holistic-review fixes), each TDD'd and reviewed. Full suite 106 tests / 28 files green, tsc 0, build OK. Plan + per-task briefs/reports in `.superpowers/sdd/`; deferred non-blocking items recorded in `.superpowers/sdd/progress.md` (notably: consecutive_breaches debounces poller ticks not collection cycles; collectors don't thread `now` causing a small collection-window gap; balance/errors collectors have a page_size=100 ceiling with no pagination; no monitor-tasks edit page).
