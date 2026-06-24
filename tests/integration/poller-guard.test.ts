/**
 * Integration test: poller single-instance guard
 *
 * Verifies that the poller init (whether via module auto-init or explicit
 * startPoller() calls) only registers setInterval once across multiple calls.
 *
 * The guard uses the timer handle (getPollerTimer/setPollerTimer) rather than
 * the per-tick concurrency flag (isPollerRunning/__checkCxPollerRunning).
 * This is correct because tick() resets __checkCxPollerRunning to false in its
 * finally block — so after the first tick completes, the old isPollerRunning()
 * guard would pass again and a second setInterval would be registered on the
 * next startPoller() call (e.g. from Next.js HMR). The timer handle is set
 * once and never cleared by tick(), making it a reliable monotonic guard.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

// --- Real in-memory timer state (mirrors global-state semantics without globalThis) ---
// getPollerTimer/setPollerTimer use their own slot so we can let them
// run as real logic while still controlling the per-tick running flag.
// NOTE: this is module-level state; tests share it across the cached module.
let _timer: ReturnType<typeof setInterval> | undefined = undefined;

// Per-tick concurrency lock (mirrors __checkCxPollerRunning in tick())
let _tickRunning = false;

vi.mock("@/lib/core/global-state", () => ({
  // Timer guard — uses real in-memory state (NOT a stub returning undefined)
  getPollerTimer: () => _timer,
  setPollerTimer: (t: ReturnType<typeof setInterval>) => { _timer = t; },

  // Per-tick concurrency lock — can be flipped externally to simulate tick completion
  isPollerRunning: () => _tickRunning,
  setPollerRunning: (val: boolean) => { _tickRunning = val; },

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
    // Reset timer guard and per-tick lock before each test
    _timer = undefined;
    _tickRunning = false;
    // Use fake timers so setInterval calls never actually fire
    vi.useFakeTimers();
    setIntervalSpy = vi.spyOn(globalThis, "setInterval");
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  it("exactly 1 setInterval registered: explicit calls after fresh timer state", async () => {
    // _timer is undefined (reset by beforeEach), so startPoller() will register one interval
    setIntervalSpy.mockClear();

    const { startPoller } = await import("@/lib/core/poller");

    // First call — registers the interval and sets _timer
    startPoller();
    expect(setIntervalSpy).toHaveBeenCalledTimes(1);
    expect(_timer).toBeDefined();

    // Subsequent calls — must be no-ops because _timer is now set
    startPoller();
    startPoller();

    expect(setIntervalSpy).toHaveBeenCalledTimes(1);
  });

  it("startPoller() called when timer already set is a no-op — no extra setInterval", async () => {
    // Pre-set the timer to simulate an already-started poller
    vi.useFakeTimers();
    _timer = setInterval(() => {}, 99999) as ReturnType<typeof setInterval>;
    setIntervalSpy.mockClear();

    const { startPoller } = await import("@/lib/core/poller");

    startPoller(); // guard fires — returns immediately (timer set)
    startPoller(); // guard fires — returns immediately (timer set)

    // No new setInterval registrations because guard returned early every time
    expect(setIntervalSpy).toHaveBeenCalledTimes(0);
  });

  it("REGRESSION: after tick completes (resets per-tick lock), startPoller() is still a no-op", async () => {
    // This is the critical regression test for the bug:
    // Old code used isPollerRunning() as the init guard. tick() resets
    // __checkCxPollerRunning to false in its finally block. So after the first
    // tick completes, a second startPoller() call would pass the guard and
    // register a second setInterval — duplicate polling and DB writes.
    //
    // The fix: use getPollerTimer() as the guard. The timer handle is set once
    // on first startPoller() and NEVER cleared by tick(), so it remains truthy
    // after tick completion and correctly blocks re-registration.

    setIntervalSpy.mockClear();

    const { startPoller } = await import("@/lib/core/poller");

    // Step 1: First startPoller() — registers the interval and sets _timer
    startPoller();
    expect(setIntervalSpy).toHaveBeenCalledTimes(1);
    expect(_timer).toBeDefined();

    // Step 2: SIMULATE tick completion
    // tick() sets __checkCxPollerRunning = true at start and resets to false in finally.
    // Here we simulate that reset — as if tick() just finished.
    _tickRunning = false;

    // Step 3: Second startPoller() — simulates HMR re-importing poller module
    // With the old buggy guard (isPollerRunning()), _tickRunning=false would make
    // isPollerRunning() return false, the guard passes, and a SECOND setInterval
    // would be registered.
    // With the fixed guard (getPollerTimer()), _timer is still set from step 1,
    // so the guard correctly returns early — no second setInterval.
    startPoller();

    // MUST still be exactly 1 — the second call after tick reset is a no-op
    expect(setIntervalSpy).toHaveBeenCalledTimes(1);
  });

  it("guard transitions: timer is set on first call and stays set after multiple calls", async () => {
    // _timer starts undefined (reset in beforeEach)
    expect(_timer).toBeUndefined();

    const { startPoller } = await import("@/lib/core/poller");

    // First explicit call when timer is not set — should register and set timer
    startPoller();
    expect(_timer).toBeDefined();

    const timerAfterFirst = _timer;

    startPoller(); // second call — no-op, timer handle unchanged
    expect(_timer).toBe(timerAfterFirst);
  });
});
