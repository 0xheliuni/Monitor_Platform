import "server-only";
import { getDb } from "./client";

export type AvailabilityRow = {
  config_id: string; period: "7d" | "15d" | "30d";
  total_checks: number; operational_count: number; availability_pct: number | null;
};

const PERIODS: { period: "7d" | "15d" | "30d"; days: number }[] = [
  { period: "7d", days: 7 }, { period: "15d", days: 15 }, { period: "30d", days: 30 },
];

export async function getAvailabilityStats(configIds: string[] | null): Promise<AvailabilityRow[]> {
  const db = getDb();
  const scoped = configIds && configIds.length > 0;
  const filterIds = scoped ? `AND config_id IN (${configIds.map(() => "?").join(",")})` : "";
  const result: AvailabilityRow[] = [];
  for (const { period, days } of PERIODS) {
    const cutoff = new Date(Date.now() - days * 86400000).toISOString();
    const params = scoped ? [cutoff, ...configIds] : [cutoff];
    const rows = db.prepare(
      `SELECT config_id,
              COUNT(*) AS total_checks,
              SUM(CASE WHEN status IN ('operational','degraded') THEN 1 ELSE 0 END) AS operational_count
       FROM check_history
       WHERE checked_at > ? ${filterIds}
       GROUP BY config_id`
    ).all(...params) as { config_id: string; total_checks: number; operational_count: number }[];
    for (const r of rows) {
      result.push({
        config_id: r.config_id,
        period,
        total_checks: r.total_checks,
        operational_count: r.operational_count,
        availability_pct: r.total_checks > 0
          ? Math.round((10000 * r.operational_count) / r.total_checks) / 100
          : null,
      });
    }
  }
  result.sort((a, b) => a.config_id.localeCompare(b.config_id) || a.period.localeCompare(b.period));
  return result;
}
