import { randomUUID } from "node:crypto";

export function toJson(value: unknown): string | null {
  if (value === null || value === undefined) return null;
  return JSON.stringify(value);
}

export function fromJson<T>(text: string | null): T | null {
  if (!text) return null;
  try {
    return JSON.parse(text) as T;
  } catch {
    return null;
  }
}

export function toBool(value: 0 | 1 | null | undefined): boolean {
  return value === 1;
}

export function fromBool(value: boolean | null | undefined): 0 | 1 {
  return value ? 1 : 0;
}

export function nowIso(): string {
  return new Date().toISOString();
}

export function newId(): string {
  return randomUUID();
}
