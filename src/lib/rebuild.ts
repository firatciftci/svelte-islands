/** Limits on rerunning a page to recover a part that's missing from memory and the store. */
export type RebuildOptions = {
  /** How many pages can rerun at once. The default is `4`. */
  concurrency?: number;
  /** How many can wait for a turn. When the queue is full, the server answers 503 and the browser retries. The default is `32`. */
  queue?: number;
  /** How long before the same page can rerun, in milliseconds. The default is `30_000`. */
  cooldown?: number;
  /** How long each run, and each fresh request's render, can take, in milliseconds. The default is `30_000`. */
  timeout?: number;
};

export const REBUILD_DEFAULTS: Required<RebuildOptions> = {
  concurrency: 4,
  queue: 32,
  cooldown: 30_000,
  timeout: 30_000,
};

const REMEMBERED = 4096;

class Late extends Error {}

export async function deadline<T>(work: Promise<T>, limit: number) {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const late = new Promise<never>((_, reject) => {
    timer = setTimeout(() => {
      reject(new Late(`no answer in ${limit} ms`));
    }, limit);
  });
  try {
    return await Promise.race([work, late]);
  } finally {
    clearTimeout(timer);
  }
}

export function gate(limits: () => { concurrency: number; queue: number }) {
  const line: Array<() => void> = [];
  let running = 0;

  return {
    isFull: () =>
      running >= limits().concurrency && line.length >= limits().queue,
    queued: () => line.length,
    async pass<T>(run: () => Promise<T>) {
      if (running < limits().concurrency) {
        running++;
      } else {
        await new Promise<void>((resolve) => {
          line.push(resolve);
        });
      }
      try {
        return await run();
      } finally {
        const next = line.shift();
        if (next == null) {
          running--;
        } else {
          next();
        }
      }
    },
  };
}

export function rebuilds<T>(
  limits: () => Required<RebuildOptions>,
  now: () => number = Date.now,
) {
  const flights = new Map<string, Promise<T>>();
  const settled = new Map<string, number>();
  const turns = gate(limits);

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
    try {
      return await turns.pass(async () => {
        try {
          const found = await deadline(run(), limits().timeout);
          settle(key);
          return found;
        } catch (error) {
          if (error instanceof Late) {
            settle(key);
          }
          throw error;
        }
      });
    } finally {
      flights.delete(key);
    }
  }

  async function rebuild(
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
    if (turns.isFull()) {
      return { status: "busy" };
    }
    const flight = fly(key, run);
    flights.set(key, flight);
    return { status: "ran", found: await flight };
  }

  return Object.assign(rebuild, { queued: turns.queued });
}
