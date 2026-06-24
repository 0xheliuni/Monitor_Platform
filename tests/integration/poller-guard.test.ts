/**
 * Integration test: poller single-instance guard
 *
 * Verifies that the poller init (whether via module auto-init or explicit
 * startPoller() calls) only registers setInterval once across multiple calls.
 * The second call is a no-op because isPollerRunning() returns true after the
 * first call, which prevents a second setInterval registration.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

// --- mock global-state so we control isPollerRunning state ---
let _running = false;

vi.mock("@/lib/core/global-state", () => ({
  isPollerRunning: () => _running,
  setPollerRunning: (val: boolean) => { _running = val; },
  getPollerTimer: () => undefined,
  setPollerTimer: vi.fn(),
  getLastPingStartedAt: () => undefined,
  setLastPingStartedAt: vi.fn(),
  getPingCacheEntry: vi.fn(),
  getPingCacheStore: vi.fn(),
  clearPingCache: vi.fn(),
}));

// --- mock official-status-poller so startOfficialStatusPoller doesn't run ---
vi.mock("@/lib/core/official-status-poller", () => ({
  startOfficialStatusPoller: vi.fn(),
  getOfficialStatus: vi.fn(),
  getAllOfficialStatuses: vi.fn(),
  ensureOfficialStatusPoller: vi.fn(),
  stopOfficialStatusPoller: vi.fn(),
}));

// --- mock polling-config ---
vi.mock("@/lib/core/polling-config", () => ({
  getPollingIntervalMs: () => 60_000,
  getOfficialStatusIntervalMs: () => 300_000,
}));

// --- mock database/config-loader and providers so tick() can't fire ---
vi.mock("@/lib/database/config-loader", () => ({
  loadProviderConfigsFromDB: vi.fn().mockResolvedValue([]),
}));

vi.mock("@/lib/providers", () => ({
  runProviderChecks: vi.fn().mockResolvedValue([]),
}));

vi.mock("@/lib/database/history", () => ({
  historySnapshotStore: {
    append: vi.fn(),
    fetch: vi.fn().mockResolvedValue({}),
  },
}));

describe("poller single-instance guard", () => {
  let setIntervalSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    // Use fake timers so setInterval calls never actually fire
    vi.useFakeTimers();
    setIntervalSpy = vi.spyOn(globalThis, "setInterval");
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  it("exactly 1 setInterval registered: module auto-init + 2 explicit calls = 1 total", async () => {
    // Reset guard so module auto-init (bottom of poller.ts) is the FIRST call
    _running = false;
    setIntervalSpy.mockClear();

    const { startPoller } = await import("@/lib/core/poller");

    // Auto-init fired on first import: registered 1 interval, _running = true
    // Extra explicit calls — must be no-ops (guard returns early)
    startPoller();
    startPoller();

    // Regardless of how many times startPoller() was called, only 1 setInterval
    expect(setIntervalSpy).toHaveBeenCalledTimes(1);
  });

  it("startPoller() called when already running is a no-op — no extra setInterval", async () => {
    // Simulate: poller already started (e.g. hot-reload scenario)
    _running = true;
    setIntervalSpy.mockClear();

    const { startPoller } = await import("@/lib/core/poller");

    startPoller(); // guard fires — returns immediately
    startPoller(); // guard fires — returns immediately

    // No setInterval registrations because guard returned early every time
    expect(setIntervalSpy).toHaveBeenCalledTimes(0);
  });

  it("guard transitions _running from false to true on first call and stays true", async () => {
    _running = false;

    const { startPoller } = await import("@/lib/core/poller");

    // startPoller() is called at module bottom — but module is cached in vitest
    // so we call it explicitly here to verify the transition
    // If _running was already set true by a prior test's auto-init, reset first:
    _running = false;

    startPoller(); // first call
    expect(_running).toBe(true);

    startPoller(); // second call — no-op
    expect(_running).toBe(true);
  });
});
