import type { RequestEvent } from "@sveltejs/kit";
import type { Handle } from "@sveltejs/kit/hooks";
import { building, dev } from "$app/env";
import { getRequestEvent } from "$app/server";
import { createHash, randomUUID } from "node:crypto";
import { render } from "svelte/server";
import type { Fetch } from "./part.js";
import type { RebuildOptions } from "./rebuild.js";
import type { Store } from "./stores.js";
import Frame from "./frame.svelte";
import { Part, provide, quietly, serialize, settings } from "./part.js";
import { REBUILD_DEFAULTS, rebuilds } from "./rebuild.js";
import { outline, skeletonize } from "./skeleton.js";

export type { RebuildOptions } from "./rebuild.js";
export type { Store } from "./stores.js";

const TOKEN = "x-svelte-islands-token";
const SHAPES = "skeletons.json";
const NAMES = "skeleton-names";
const FILE = /^[\w-]{22}\.(?:json|html)$/u;
const RELEARN = 10 * 60_000;
const OUTLINES = 4096;
const HOLLOW = 3;
const IMMUTABLE = "public, max-age=31536000, immutable";
const MIN_COMPRESSED = 1024;
const SETTLE = 1000;

type Digest = { text: string; hash: string };

const digests = new WeakMap<object, Digest>();
const recent = new Map<string, string>();
const exemplars = new Map<string, Map<string, { html: string; at: number }>>();
const asked = new Set<string>();
const waiting = new Map<string, Map<string, Digest>>();
const requests = new WeakMap<
  object,
  {
    parts: Set<Part>;
    files: Set<string>;
    isHeaded: boolean;
    isPersonal: boolean;
    writes: Array<Promise<unknown>>;
  }
>();
const warned = new Set<string>();
const squeezed = new Map<
  string,
  { size: number; work: Promise<Uint8Array<ArrayBuffer> | null> }
>();
const outlines = new Map<string, string>();
const hollow = new Map<string, { count: number; at: number }>();
type Prepare = (
  request: { url: URL; headers: Headers },
  event: RequestEvent,
) => void;

const config: {
  store: Store | null;
  memory: number;
  prepare: Prepare;
  vary: (event: RequestEvent) => string;
  rebuild: Required<RebuildOptions> | null;
  compress: boolean;
  warnOnCookies: boolean;
} = {
  store: null,
  memory: 64 * 1024 ** 2,
  prepare: () => {},
  vary: () => "",
  rebuild: REBUILD_DEFAULTS,
  compress: true,
  warnOnCookies: true,
};
const state: {
  held: number;
  squeezed: number;
  names: Promise<unknown> | null;
} = { held: 0, squeezed: 0, names: null };
const rebuild = rebuilds<Map<string, Digest>>(
  () => config.rebuild ?? REBUILD_DEFAULTS,
);

function hashOf(text: string) {
  return createHash("sha256").update(text).digest("base64url").slice(0, 22);
}

function digest(value: unknown, isPrivate: boolean) {
  if (isPrivate) {
    const text = serialize(value, true);
    return { text, hash: hashOf(text) };
  }
  const isObject = typeof value === "object" && value != null;
  const known = isObject ? digests.get(value) : undefined;
  if (known != null) {
    return known;
  }
  const text = serialize(value);
  const made = { text, hash: hashOf(text) };
  if (isObject) {
    digests.set(value, made);
  }
  return made;
}

function hold({ hash, text }: Digest) {
  const known = recent.get(hash);
  if (known != null) {
    recent.delete(hash);
    recent.set(hash, known);
    return false;
  }
  recent.set(hash, text);
  state.held += text.length;
  for (const [oldest, kept] of recent) {
    if (building || state.held <= config.memory) {
      break;
    }
    recent.delete(oldest);
    state.held -= kept.length;
  }
  return true;
}

function write(key: string, text: string, event: RequestEvent | null) {
  const work = quietly(config.store?.set(key, text));
  if (event != null && config.store != null) {
    track(event.locals).writes.push(work);
  }
}

function keep(made: Digest, event: RequestEvent) {
  if (hold(made)) {
    write(`p:${made.hash}`, made.text, event);
  }
  const token = event.request.headers.get(TOKEN);
  if (token != null) {
    waiting.get(token)?.set(made.hash, made);
  }
}

function track(locals: object) {
  let found = requests.get(locals);
  if (found == null) {
    found = {
      parts: new Set(),
      files: new Set(),
      isHeaded: false,
      isPersonal: false,
      writes: [],
    };
    requests.set(locals, found);
  }
  return found;
}

function sourceOf(url: URL) {
  if (building) {
    return url.pathname;
  }
  const search = new URLSearchParams(
    [...url.searchParams].filter(([name]) => !name.startsWith("x-sveltekit-")),
  ).toString();
  return search === "" ? url.pathname : `${url.pathname}?${search}`;
}

function flatten(known: Map<string, { html: string }>) {
  return Object.fromEntries(
    known.entries().map(([key, { html }]) => [key, html]),
  );
}

function examplesOf(name: string) {
  let known = exemplars.get(name);
  if (known == null) {
    known = new Map();
    exemplars.set(name, known);
  }
  return known;
}

function attempt(html: () => string) {
  try {
    const rendered = html();
    return rendered.includes("island-fallback") ? null : skeletonize(rendered);
  } catch {
    return null;
  }
}

function outlined(identity: string, html: () => string, view?: string) {
  const found = outlines.get(identity);
  if (found != null) {
    return found;
  }
  const seen = view == null ? null : hollow.get(view);
  if (seen != null && seen.count >= HOLLOW && Date.now() - seen.at < RELEARN) {
    return "";
  }
  let made = "";
  try {
    made = outline(html());
  } catch {
    made = "";
  }
  if (view != null) {
    if (made === "") {
      hollow.set(view, { count: (seen?.count ?? 0) + 1, at: Date.now() });
    } else {
      hollow.delete(view);
    }
  }
  if (outlines.size >= OUTLINES) {
    const oldest = outlines.keys().next();
    if (!oldest.done) {
      outlines.delete(oldest.value);
    }
  }
  outlines.set(identity, made);
  return made;
}

async function recallAll() {
  const { store } = config;
  if (store == null) {
    return;
  }
  const recallNames = async () => {
    const text = await store.get(NAMES);
    const parsed: unknown = text == null ? null : JSON.parse(text);
    await Promise.all(
      (Array.isArray(parsed) ? parsed : []).flatMap((name: unknown) =>
        typeof name === "string" ? [recall(name)] : [],
      ),
    );
  };
  state.names ??= quietly(recallNames());
  await state.names;
}

async function index() {
  await recallAll();
  await config.store?.set(NAMES, JSON.stringify(exemplars.keys().toArray()));
}

function current() {
  try {
    return getRequestEvent();
  } catch {
    return null;
  }
}

function learn(name: string, key: string, html: () => string) {
  const known = examplesOf(name);
  const found = known.get(key);
  if (found != null && Date.now() - found.at < RELEARN) {
    return found.html;
  }
  const shaped = attempt(html);
  if (shaped == null || shaped === "") {
    return found?.html ?? null;
  }
  const isNew = known.size === 0;
  known.set(key, { html: shaped, at: Date.now() });
  if (found?.html !== shaped) {
    write(`skeletons:${name}`, JSON.stringify(flatten(known)), current());
  }
  if (isNew) {
    void quietly(index());
  }
  return shaped;
}

async function recall(name: string) {
  const { store } = config;
  if (store == null || asked.has(name)) {
    return;
  }
  asked.add(name);
  try {
    const text = await store.get(`skeletons:${name}`);
    const parsed: unknown = text == null ? null : JSON.parse(text);
    if (typeof parsed !== "object" || parsed == null) {
      return;
    }
    const known = examplesOf(name);
    for (const [key, html] of Object.entries(parsed)) {
      if (typeof html === "string" && !known.has(key)) {
        known.set(key, { html, at: 0 });
      }
    }
  } catch {
    asked.delete(name);
  }
}

function warnPersonal(name: string, found: { isPersonal: boolean }) {
  if (!dev || !config.warnOnCookies || !found.isPersonal || warned.has(name)) {
    return;
  }
  warned.add(name);
  console.warn(
    `svelte-islands: part("${name}") was made during a request that read cookies. Parts are served from a public, immutable URL. If this value differs per visitor, pass { private: true }. If it doesn't, pass warnOnCookies: false to handle().`,
  );
}

/**
 * Wraps a value from a server `load` so it travels outside the page's data.
 *
 * Parts over the `inline` limit are stored under a hash of their contents and
 * served from a public, immutable URL. Pass `private: true` for anything that
 * differs per visitor: a private part is never stored and always stays in the
 * page's data.
 *
 * @param name A stable name for this kind of data. Skeletons are learned per name.
 * @param value The value to send. Plain data travels in a compact packed form.
 * @param options When the part loads and who may see it.
 * @param options.fetch When the browser requests the part: `"auto"`, `"lazy"`, or `"preload"`.
 * @param options.private Keeps the part out of the store and off public URLs.
 */
export function part<T>(
  name: string,
  value: T,
  {
    fetch = "auto",
    private: isPrivate = false,
  }: { fetch?: Fetch; private?: boolean } = {},
): Part<T> {
  const event = getRequestEvent();
  const made = digest(value, isPrivate);
  const found = track(event.locals);
  if (!isPrivate) {
    warnPersonal(name, found);
    keep(made, event);
  }
  const created = new Part<T>({
    name,
    hash: made.hash,
    source: sourceOf(event.url),
    bytes: made.text.length,
    fetch,
    isEager: fetch === "preload" || (fetch === "auto" && event.isDataRequest),
    isPrivate,
    loaded: { value },
  });
  found.parts.add(created);
  return created;
}

provide(() => {
  const event = current();
  if (event == null) {
    return null;
  }
  return {
    render: (body, value, context, prefix) =>
      render(Frame, { props: { body, value }, context, idPrefix: prefix }).body,
    skeleton: (name, key, html) => {
      void recall(name);
      return learn(name, key, html);
    },
    shape: (name) => {
      void recall(name);
      return exemplars.get(name)?.get(name)?.html ?? null;
    },
    stash: (html) => {
      const made = { text: html, hash: `${hashOf(html)}.html` };
      keep(made, event);
      track(event.locals).files.add(made.hash);
      return made.hash;
    },
    outline: (identity, html, view) =>
      outlined(`${config.vary(event)}:${identity}`, html, view),
    awaited: (error, name) => {
      const isAwait =
        error instanceof Error && error.message.includes("await_invalid");
      if (isAwait && dev) {
        console.warn(
          `svelte-islands: the island for part("${name}") uses await while rendering, so it renders in the browser instead of the server HTML. To keep it in the server HTML, load that data into the part.`,
        );
      }
      return isAwait;
    },
  };
});

function preloads({ parts }: { parts: Set<Part> }) {
  return parts
    .values()
    .filter((created) => created.fetch === "preload" && !created.isInline)
    .map(
      (created) =>
        `<link rel="preload" href="${settings.prefix}${created.hash}.json" as="fetch" crossorigin="anonymous">`,
    );
}

function crawlable({ parts, files }: { parts: Set<Part>; files: Set<string> }) {
  const published = new Set([
    SHAPES,
    ...files,
    ...parts
      .values()
      .filter((created) => !created.isInline)
      .map((created) => `${created.hash}.json`),
  ]);
  return published
    .values()
    .map(
      (file) => `<link rel="svelte-islands" href="${settings.prefix}${file}">`,
    );
}

function inject(html: string, event: RequestEvent) {
  const found = requests.get(event.locals);
  if (found == null || found.isHeaded) {
    return html;
  }
  found.isHeaded = true;
  const at = html.indexOf("</head>");
  const links = (building ? crawlable(found) : preloads(found)).toArray();
  return at === -1 || links.length === 0
    ? html
    : `${html.slice(0, at)}${links.join("")}${html.slice(at)}`;
}

function pageOf(event: RequestEvent) {
  const source = event.url.searchParams.get("u");
  if (source?.startsWith("/") !== true) {
    return null;
  }
  try {
    const target = new URL(source, event.url.origin);
    return target.origin === event.url.origin &&
      !target.pathname.startsWith(settings.prefix)
      ? target
      : null;
  } catch {
    return null;
  }
}

async function rerun(isMarkup: boolean, target: URL, event: RequestEvent) {
  const token = randomUUID();
  const found = new Map<string, Digest>();
  waiting.set(token, found);
  try {
    const data = isMarkup
      ? target
      : new URL(
          `${target.pathname.replace(/\/$/u, "")}/__data.json${target.search}`,
          event.url.origin,
        );
    const headers = new Headers({ [TOKEN]: token });
    const language = event.request.headers.get("accept-language");
    if (language != null) {
      headers.set("accept-language", language);
    }
    config.prepare({ url: data, headers }, event);
    const response = await event.fetch(data, { headers });
    await response.arrayBuffer();
    return found;
  } finally {
    waiting.delete(token);
  }
}

async function recover(file: string, event: RequestEvent) {
  const target = building || config.rebuild == null ? null : pageOf(event);
  if (target == null) {
    return null;
  }
  const isMarkup = file.endsWith(".html");
  const language = event.request.headers.get("accept-language") ?? "";
  const outcome = await rebuild(
    [
      isMarkup ? "html" : "data",
      config.vary(event),
      language,
      `${target.pathname}${target.search}`,
    ].join("\n"),
    async () => rerun(isMarkup, target, event),
  );
  if (outcome.status === "busy") {
    throw new Error("busy");
  }
  return outcome.status === "ran"
    ? (outcome.found.get(file)?.text ?? null)
    : null;
}

const ALREADY_ENCODED = { encodeBody: "manual" } as const;

async function brotli(text: string) {
  try {
    const { brotliCompress, constants } = await import("node:zlib");
    return await new Promise<Uint8Array<ArrayBuffer> | null>((resolve) => {
      brotliCompress(
        text,
        {
          params: {
            [constants.BROTLI_PARAM_QUALITY]: text.length > 1024 ** 2 ? 5 : 9,
            [constants.BROTLI_PARAM_SIZE_HINT]: text.length,
          },
        },
        (error, result) => {
          resolve(error == null ? new Uint8Array(result) : null);
        },
      );
    });
  } catch {
    return null;
  }
}

async function squeeze(file: string, text: string) {
  const known = squeezed.get(file);
  if (known != null) {
    return known.work;
  }
  const entry = { size: 0, work: brotli(text) };
  squeezed.set(file, entry);
  const result = await entry.work;
  if (result == null) {
    squeezed.delete(file);
    return null;
  }
  entry.size = result.length;
  state.squeezed += result.length;
  for (const [oldest, { size }] of squeezed) {
    if (state.squeezed <= config.memory / 4) {
      break;
    }
    squeezed.delete(oldest);
    state.squeezed -= size;
  }
  return result;
}

async function encoded(file: string, text: string, event: RequestEvent) {
  const accepts = event.request.headers.get("accept-encoding") ?? "";
  return config.compress &&
    text.length >= MIN_COMPRESSED &&
    /\bbr\b/u.test(accepts)
    ? squeeze(file, text)
    : null;
}

async function shapes(event: RequestEvent) {
  await recallAll();
  const all: Record<string, string> = {};
  for (const known of exemplars.values()) {
    Object.assign(all, flatten(known));
  }
  const text = JSON.stringify(all);
  const hash = hashOf(text);
  const compressed = await encoded(`${SHAPES}:${hash}`, text, event);
  return new Response(compressed ?? text, {
    ...ALREADY_ENCODED,
    headers: {
      "content-type": "application/json; charset=utf-8",
      "cache-control": "public, max-age=600, stale-while-revalidate=86400",
      vary: "accept-encoding",
      etag: compressed == null ? `"${hash}"` : `"${hash}-br"`,
      ...(compressed != null && { "content-encoding": "br" }),
    },
  });
}

async function respond(event: RequestEvent) {
  const file = event.url.pathname.slice(settings.prefix.length);
  const isRead = ["GET", "HEAD"].includes(event.request.method);
  if (isRead && file === SHAPES) {
    return shapes(event);
  }
  if (!isRead || !FILE.test(file)) {
    return new Response(null, { status: 404 });
  }
  const etag = `"${file}"`;
  if (event.request.headers.get("if-none-match")?.includes(file) === true) {
    return new Response(null, {
      status: 304,
      headers: { etag, "cache-control": IMMUTABLE, vary: "accept-encoding" },
    });
  }
  const key = file.replace(/\.json$/u, "");
  let text: string | null = null;
  try {
    text =
      recent.get(key) ??
      (await quietly(config.store?.get(`p:${key}`))) ??
      (await recover(key, event));
  } catch {
    return new Response(null, {
      status: 503,
      headers: { "cache-control": "no-store", "retry-after": "1" },
    });
  }
  if (text == null) {
    return new Response(null, {
      status: 404,
      headers: { "cache-control": "no-store" },
    });
  }
  const compressed = await encoded(file, text, event);
  const type = file.endsWith(".html")
    ? "text/html; charset=utf-8"
    : "application/json; charset=utf-8";
  const init: ResponseInit & typeof ALREADY_ENCODED = {
    ...ALREADY_ENCODED,
    headers: {
      "content-type": type,
      "cache-control": IMMUTABLE,
      vary: "accept-encoding",
      etag: compressed == null ? etag : `"${file}-br"`,
      ...(compressed != null && { "content-encoding": "br" }),
    },
  };
  return new Response(compressed ?? text, init);
}

function lifetimeOf(platform: unknown) {
  if (typeof platform !== "object" || platform == null) {
    return null;
  }
  const { ctx, context } = platform as {
    ctx?: { waitUntil?: (work: Promise<unknown>) => void };
    context?: { waitUntil?: (work: Promise<unknown>) => void };
  };
  return ctx ?? context ?? null;
}

async function settle(event: RequestEvent) {
  const writes = requests.get(event.locals)?.writes ?? [];
  if (writes.length === 0) {
    return;
  }
  const work = Promise.all(writes);
  const lifetime = lifetimeOf(event.platform);
  if (lifetime?.waitUntil != null) {
    lifetime.waitUntil(work);
    return;
  }
  let timer: ReturnType<typeof setTimeout> | undefined;
  await Promise.race([
    work,
    new Promise((resolve) => {
      timer = setTimeout(resolve, SETTLE);
    }),
  ]);
  clearTimeout(timer);
}

function watchCookies(event: RequestEvent) {
  const { cookies } = event;
  const found = track(event.locals);
  const { get, getAll } = cookies;
  cookies.get = (...args) => {
    found.isPersonal = true;
    return get.apply(cookies, args);
  };
  cookies.getAll = (...args) => {
    found.isPersonal = true;
    return getAll.apply(cookies, args);
  };
}

const handler: Handle = async ({ event, resolve }) => {
  if (event.url.pathname.startsWith(settings.prefix)) {
    return respond(event);
  }
  if (dev && config.warnOnCookies) {
    watchCookies(event);
  }
  const response = await resolve(event, {
    transformPageChunk: ({ html }) => inject(html, event),
  });
  await settle(event);
  return response;
};

/**
 * The SvelteKit handle that serves parts and deferred HTML and adds preload links.
 * Add it to `sequence()` in `hooks.server.ts`.
 *
 * @param options Settings for the handle.
 * @param options.store Persists parts, deferred HTML, and skeletons across restarts and servers.
 * @param options.memory How many characters of parts and deferred HTML to keep in memory. The default is 64 MiB.
 * @param options.prepare Adjusts the internal request used to rebuild a part.
 * @param options.vary Returns anything other than an island's data that changes its text, such as the locale.
 * @param options.rebuild Limits on rerunning a page to recover a missing part, or `false` to answer 404 instead.
 * @param options.compress Serves parts and the skeleton file with Brotli when the browser accepts it. The default is `true`.
 * @param options.warnOnCookies Warns in dev when a public part is made after a request read cookies. The default is `true`.
 */
export function handle({
  store = null,
  memory = config.memory,
  prepare = () => {},
  vary = () => "",
  rebuild: limits = {},
  compress = true,
  warnOnCookies = true,
}: {
  store?: Store | null;
  memory?: number;
  prepare?: Prepare;
  vary?: (event: RequestEvent) => string;
  rebuild?: RebuildOptions | false;
  compress?: boolean;
  warnOnCookies?: boolean;
} = {}): Handle {
  config.store = store;
  config.memory = memory;
  config.prepare = prepare;
  config.vary = vary;
  config.rebuild = limits === false ? null : { ...REBUILD_DEFAULTS, ...limits };
  config.compress = compress;
  config.warnOnCookies = warnOnCookies;
  return handler;
}
