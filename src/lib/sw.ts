const CACHE = "svelte-islands-parts";
const LIMIT = 500;
const SKELETONS = "skeletons";

async function trim(cache: Cache, limit: number) {
  const keys = await cache.keys();
  const oldest = keys.slice(0, Math.max(0, keys.length - limit));
  for (const key of oldest) {
    await cache.delete(key);
  }
}

async function keep(
  name: string,
  key: string,
  response: Response,
  limit: number,
) {
  if (!response.ok) {
    return;
  }
  const cache = await caches.open(name);
  await cache.put(key, response);
  await trim(cache, limit);
}

/**
 * Serves part downloads from a service worker, so that a page that has been
 * visited before still works offline. Parts and deferred HTML are named by a
 * hash of their contents, so they come from the cache when they're there. The
 * skeleton file changes over time, so it comes from the network when it can.
 *
 * Call it first in your `fetch` listener. It returns `true` when it handled the
 * request:
 *
 * ```ts
 * worker.addEventListener("fetch", (event) => {
 *   if (serveParts(event)) {
 *     return;
 *   }
 *   // Your own handling of pages and assets.
 * });
 * ```
 *
 * Private parts never reach this cache, because they have no URL.
 *
 * @param event The service worker's fetch event.
 * @param event.request The request being made.
 * @param event.respondWith Answers the request.
 * @param event.waitUntil Keeps the worker alive while a response is stored.
 * @param options Where parts live and how many to keep.
 * @param options.prefix The URL prefix of parts. Include your base path if you have one.
 * @param options.cache The name of the cache to keep them in.
 * @param options.limit The most responses to keep. The oldest go first.
 */
export function serveParts(
  event: {
    request: Request;
    respondWith: (response: Promise<Response>) => void;
    waitUntil: (work: Promise<unknown>) => void;
  },
  {
    prefix = "/_parts/",
    cache: name = CACHE,
    limit = LIMIT,
  }: { prefix?: string; cache?: string; limit?: number } = {},
) {
  const { request } = event;
  const url = new URL(request.url);
  if (
    request.method !== "GET" ||
    url.origin !== location.origin ||
    !url.pathname.startsWith(prefix)
  ) {
    return false;
  }
  const key = url.pathname;

  async function download() {
    const response = await fetch(request);
    event.waitUntil(keep(name, key, response.clone(), limit));
    return response;
  }

  async function cached() {
    const cache = await caches.open(name);
    return cache.match(key);
  }

  async function latest() {
    try {
      return await download();
    } catch (error) {
      const found = await cached();
      if (found == null) {
        throw error;
      }
      return found;
    }
  }

  async function stored() {
    return (await cached()) ?? download();
  }

  event.respondWith(
    url.pathname === `${prefix}${SKELETONS}` ? latest() : stored(),
  );
  return true;
}
