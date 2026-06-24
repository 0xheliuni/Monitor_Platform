/**
 * 数据库配置加载模块
 */

import "server-only";
import { loadEnabledConfigsWithModelTemplate } from "@/lib/db/configs";
import {getPollingIntervalMs} from "../core/polling-config";
import type {ProviderConfig, ProviderType} from "../types";
import {logError} from "../utils";

interface ConfigCache {
  data: ProviderConfig[];
  lastFetchedAt: number;
}

interface ConfigCacheMetrics {
  hits: number;
  misses: number;
}

const cache: ConfigCache = {
  data: [],
  lastFetchedAt: 0,
};

const metrics: ConfigCacheMetrics = {
  hits: 0,
  misses: 0,
};

export function getConfigCacheMetrics(): ConfigCacheMetrics {
  return { ...metrics };
}

export function resetConfigCacheMetrics(): void {
  metrics.hits = 0;
  metrics.misses = 0;
}

/**
 * 从数据库加载启用的 Provider 配置
 * @returns Provider 配置列表
 */
export async function loadProviderConfigsFromDB(options?: {
  forceRefresh?: boolean;
}): Promise<ProviderConfig[]> {
  try {
    const now = Date.now();
    const ttl = getPollingIntervalMs();
    if (!options?.forceRefresh && now - cache.lastFetchedAt < ttl) {
      metrics.hits += 1;
      return cache.data;
    }
    metrics.misses += 1;

    const rows = await loadEnabledConfigsWithModelTemplate();

    if (!rows || rows.length === 0) {
      console.warn("[check-cx] 数据库中没有找到启用的配置");
      cache.data = [];
      cache.lastFetchedAt = now;
      return [];
    }

    const configs: ProviderConfig[] = rows.map((r) => ({
      id: r.id,
      name: r.name,
      type: r.type as ProviderType,
      endpoint: r.endpoint,
      model: r.model,
      apiKey: r.api_key,
      is_maintenance: r.is_maintenance,
      requestHeaders: r.request_header,
      metadata: r.metadata,
      groupName: r.group_name || null,
    }));

    cache.data = configs;
    cache.lastFetchedAt = now;
    return configs;
  } catch (error) {
    logError("加载配置时发生异常", error);
    return [];
  }
}
