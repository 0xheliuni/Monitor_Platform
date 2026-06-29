import { describe, it, expect, beforeEach } from "vitest";
import { encryptSecret, decryptSecret, maskSecret } from "@/lib/db/monitor-crypto";

beforeEach(() => {
  process.env.ADMIN_SESSION_SECRET = "test-secret-please-change";
});

describe("monitor-crypto", () => {
  it("加密后能解密回原文", () => {
    const plain = "sk-abc123def456";
    const enc = encryptSecret(plain);
    expect(enc).not.toContain(plain);
    expect(decryptSecret(enc)).toBe(plain);
  });

  it("两次加密同一明文得到不同密文（随机 IV）", () => {
    expect(encryptSecret("same")).not.toBe(encryptSecret("same"));
  });

  it("脱敏只保留尾 4 位", () => {
    expect(maskSecret("sk-abcdef1234")).toBe("sk-****1234");
    expect(maskSecret("short")).toBe("****");
    expect(maskSecret(null)).toBe("");
  });

  it("密文被篡改时解密抛错", () => {
    const enc = encryptSecret("data");
    const tampered = enc.slice(0, -2) + (enc.endsWith("a") ? "bb" : "aa");
    expect(() => decryptSecret(tampered)).toThrow();
  });
});
