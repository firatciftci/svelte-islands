/** Limits on rerunning a page to recover a part that's missing from memory and the store. */
export type RebuildOptions = {
  /** How many pages can rerun at once. The default is `4`. */
  concurrency?: number;
  /** How many can wait for a turn. When the queue is full, the server answers 503 and the browser retries. The default is `32`. */
  queue?: number;
  /** How long before the same page can rerun, in milliseconds. The default is `30_000`. */
  cooldown?: number;
  /** How long each run can take, in milliseconds. The default is `30_000`. */
  timeout?: number;
};

export const REBUILD_DEFAULTS: Required<RebuildOptions> = {
  concurrency: 4,
  queue: 32,
  cooldown: 30_000,
  timeout: 30_000,
};

const REMEMBERED = 4096;

async function deadline<T>(work: Promise<T>, limit: number) {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const late = new Promise<never>((_, reject) => {
    timer = setTimeout(() => {
      reject(new Error(`no answer in ${limit} ms`));
    }, limit);
  });
  try {
    return await Promise.race([work, late]);
  } finally {
    clearTimeout(timer);
  }
}

export function rebuilds<T>(
  limits: () => Required<RebuildOptions>,
  now: () => number = Date.now,
) {
  const flights = new Map<string, Promise<T>>();
  const settled = new Map<string, number>();
  const line: Array<() => void> = [];
  let running = 0;

  async function enter() {
    if (running < limits().concurrency) {
      running++;
      return;
    }
    await new Promise<void>((resolve) => {
      line.push(resolve);
    });
  }

  function leave() {
    const next = line.shift();
    if (next == null) {
      running--;
    } else {
      next();
    }
  }

  function settle(key: string) {
    const { cooldown } = limits();
    if (cooldown <= 0) {
      return;
    }
    settled.delete(key);
    settled.set(key, now() + cooldown);
    for (const oldest of settled.keys()) {
      if (settled.size <= REMEMBERED) {
        break;
      }
      settled.delete(oldest);
    }
  }

  function isCooling(key: string) {
    const until = settled.get(key);
    if (until == null) {
      return false;
    }
    if (until > now()) {
      return true;
    }
    settled.delete(key);
    return false;
  }

  async function fly(key: string, run: () => Promise<T>) {
    await enter();
    try {
      const found = await deadline(run(), limits().timeout);
      settle(key);
      return found;
    } finally {
      flights.delete(key);
      leave();
    }
  }

  return async function rebuild(
    key: string,
    run: () => Promise<T>,
  ): Promise<
    { status: "ran"; found: T } | { status: "cooling" } | { status: "busy" }
  > {
    const joined = flights.get(key);
    if (joined != null) {
      return { status: "ran", found: await joined };
    }
    if (isCooling(key)) {
      return { status: "cooling" };
    }
    if (running >= limits().concurrency && line.length >= limits().queue) {
      return { status: "busy" };
    }
    const flight = fly(key, run);
    flights.set(key, flight);
    return { status: "ran", found: await flight };
  };
}
