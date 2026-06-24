import { describe, it, expect } from "vitest";
import { toJson, fromJson, toBool, fromBool, nowIso, newId } from "@/lib/db/json";

describe("json/bool/id helpers", () => {
  it("toJson/fromJson 往返", () => {
    expect(toJson(null)).toBeNull();
    expect(toJson({ a: 1 })).toBe('{"a":1}');
    expect(fromJson<{ a: number }>('{"a":1}')).toEqual({ a: 1 });
    expect(fromJson(null)).toBeNull();
  });
  it("bool 编解码", () => {
    expect(fromBool(true)).toBe(1);
    expect(fromBool(false)).toBe(0);
    expect(toBool(1)).toBe(true);
    expect(toBool(0)).toBe(false);
  });
  it("nowIso 是 ISO 字符串，newId 是 uuid", () => {
    expect(nowIso()).toMatch(/^\d{4}-\d{2}-\d{2}T/);
    expect(newId()).toMatch(/^[0-9a-f-]{36}$/);
  });
});
