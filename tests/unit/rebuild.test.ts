import { describe, expect, it } from "vitest";
import { REBUILD_DEFAULTS, rebuilds } from "#lib/rebuild.js";

function gate() {
  const { promise, resolve } = Promise.withResolvers<void>();
  return { open: resolve, opened: promise };
}

function setup(overrides: Partial<typeof REBUILD_DEFAULTS> = {}) {
  const clock = { now: 0 };
  const limits = { ...REBUILD_DEFAULTS, ...overrides };
  return {
    clock,
    rebuild: rebuilds<string>(
      () => limits,
      () => clock.now,
    ),
  };
}

describe("rebuilds", () => {
  it("shares one run among simultaneous requests for a page", async () => {
    const { rebuild } = setup();
    const { open, opened } = gate();
    let runs = 0;
    const run = async () => {
      runs++;
      await opened;
      return "found";
    };
    const all = [rebuild("a", run), rebuild("a", run), rebuild("a", run)];
    open();
    const results = await Promise.all(all);
    expect(runs).toBe(1);
    expect(results.map((result) => result.status)).toStrictEqual([
      "ran",
      "ran",
      "ran",
    ]);
  });

  it("remembers a finished page until the cooldown passes", async () => {
    const { clock, rebuild } = setup({ cooldown: 1000 });
    let runs = 0;
    const run = async () => {
      runs++;
      return "found";
    };
    await rebuild("a", run);
    expect((await rebuild("a", run)).status).toBe("cooling");
    clock.now = 999;
    expect((await rebuild("a", run)).status).toBe("cooling");
    clock.now = 1000;
    expect((await rebuild("a", run)).status).toBe("ran");
    expect(runs).toBe(2);
  });

  it("does not let one page's cooldown block another", async () => {
    const { rebuild } = setup();
    await rebuild("a", async () => "found");
    expect((await rebuild("b", async () => "found")).status).toBe("ran");
  });

  it("skips the cooldown when it is zero", async () => {
    const { rebuild } = setup({ cooldown: 0 });
    await rebuild("a", async () => "found");
    expect((await rebuild("a", async () => "found")).status).toBe("ran");
  });

  it("does not cool down after a failure, so the next try reruns", async () => {
    const { rebuild } = setup();
    await expect(
      rebuild("a", async () => {
        throw new Error("down");
      }),
    ).rejects.toThrow("down");
    expect((await rebuild("a", async () => "found")).status).toBe("ran");
  });

  it("runs no more than the limit and queues the rest in order", async () => {
    const { rebuild } = setup({ concurrency: 2, queue: 2 });
    const gates = [gate(), gate(), gate(), gate()];
    const started: Array<number> = [];
    let running = 0;
    let peak = 0;
    const all = gates.map(async ({ opened }, at) =>
      rebuild(String(at), async () => {
        started.push(at);
        running++;
        peak = Math.max(peak, running);
        await opened;
        running--;
        return "found";
      }),
    );
    await Promise.resolve();
    expect(started).toStrictEqual([0, 1]);
    for (const { open } of gates) {
      open();
    }
    await Promise.all(all);
    expect(peak).toBe(2);
    expect(started).toStrictEqual([0, 1, 2, 3]);
  });

  it("answers busy once the queue is full", async () => {
    const { rebuild } = setup({ concurrency: 1, queue: 1 });
    const { open, opened } = gate();
    const held = async () => {
      await opened;
      return "found";
    };
    const first = rebuild("a", held);
    const second = rebuild("b", held);
    await Promise.resolve();
    expect((await rebuild("c", held)).status).toBe("busy");
    open();
    expect((await first).status).toBe("ran");
    expect((await second).status).toBe("ran");
    expect((await rebuild("c", held)).status).toBe("ran");
  });

  it("frees the slot when a run takes too long", async () => {
    const { rebuild } = setup({ concurrency: 1, queue: 4, timeout: 5 });
    const stuck = rebuild("a", async () => new Promise<string>(() => {}));
    await expect(stuck).rejects.toThrow(/no answer/u);
    expect((await rebuild("b", async () => "found")).status).toBe("ran");
  });

  it("frees the slot when a run throws", async () => {
    const { rebuild } = setup({ concurrency: 1, queue: 0 });
    await expect(
      rebuild("a", async () => {
        throw new Error("down");
      }),
    ).rejects.toThrow("down");
    expect((await rebuild("b", async () => "found")).status).toBe("ran");
  });

  it("forgets the oldest pages past its memory limit", async () => {
    const { rebuild } = setup();
    await rebuild("first", async () => "found");
    for (let at = 0; at < 4096; at++) {
      await rebuild(String(at), async () => "found");
    }
    expect((await rebuild("first", async () => "found")).status).toBe("ran");
  });

  it("reads its limits on each call", async () => {
    const limits = { ...REBUILD_DEFAULTS, cooldown: 0 };
    const rebuild = rebuilds<string>(() => limits);
    await rebuild("a", async () => "found");
    limits.cooldown = 60_000;
    await rebuild("a", async () => "found");
    expect((await rebuild("a", async () => "found")).status).toBe("cooling");
  });
});
