export function parseTaskConfig(formData: FormData): Record<string, unknown> {
  const config: Record<string, unknown> = {};
  const model = formData.get("model")?.toString().trim();
  const format = formData.get("format")?.toString().trim();
  const endpoint = formData.get("endpoint")?.toString().trim();
  if (model) config.model = model;
  if (format) config.format = format;
  if (endpoint) config.endpoint = endpoint;
  return config;
}

export function parseRuleNumbers(formData: FormData): { threshold: number; window_seconds: number; consecutive_breaches: number } {
  return {
    threshold: Number(formData.get("threshold") ?? 0),
    window_seconds: Number(formData.get("window_seconds") ?? 0),
    consecutive_breaches: Number(formData.get("consecutive_breaches") ?? 1),
  };
}
