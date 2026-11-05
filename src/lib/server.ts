import type { RequestEvent } from "@sveltejs/kit";
import type { Handle } from "@sveltejs/kit/hooks";
import { getRequestEvent } from "$app/server";
import { createHash, randomUUID } from "node:crypto";
import { render } from "svelte/server";
import type { Fetch } from "./part.js";
import Frame from "./frame.svelte";
import { Part, provide, quietly, serialize, settings } from "./part.js";
import { outline, skeletonize } from "./skeleton.js";

export type Store = {
  get: (key: string) => Promise<string | null>;
  set: (key: string, text: string) => Promise<unknown>;
};

const TOKEN = "x-svelte-islands-token";
const SHAPES = "skeletons";
const NAMES = "skeleton-names";
const FILE = /^[\w-]{22}(?:\.html)?$/u;
const RELEARN = 10 * 60_000;
const OUTLINES = 4096;
const HOLLOW = 3;
const IMMUTABLE = "public, max-age=31536000, immutable";

type Digest = { text: string; hash: string };

const digests = new WeakMap<object, Digest>();
const recent = new Map<string, string>();
const exemplars = new Map<string, Map<string, { html: string; at: number }>>();
const asked = new Set<string>();
const waiting = new Map<string, Map<string, Digest>>();
const requests = new WeakMap<object, { parts: Set<Part>; isHeaded: boolean }>();
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
} = { store: null, memory: 64 * 1024 ** 2, prepare: () => {}, vary: () => "" };
const state: { held: number; names: Promise<unknown> | null } = {
  held: 0,
  names: null,
};

function hashOf(text: string) {
  return createHash("sha256").update(text).digest("base64url").slice(0, 22);
}

function digest(value: unknown) {
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
    if (state.held <= config.memory) {
      break;
    }
    recent.delete(oldest);
    state.held -= kept.length;
  }
  return true;
}

function keep(made: Digest, event: RequestEvent) {
  if (hold(made)) {
    void quietly(config.store?.set(`p:${made.hash}`, made.text));
  }
  const token = event.request.headers.get(TOKEN);
  if (token != null) {
    waiting.get(token)?.set(made.hash, made);
  }
}

function track(locals: object) {
  let found = requests.get(locals);
  if (found == null) {
    found = { parts: new Set(), isHeaded: false };
    requests.set(locals, found);
  }
  return found;
}

function sourceOf(url: URL) {
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
    void quietly(
      config.store?.set(`skeletons:${name}`, JSON.stringify(flatten(known))),
    );
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

export function part<T>(
  name: string,
  value: T,
  { fetch = "auto" }: { fetch?: Fetch } = {},
) {
  const event = getRequestEvent();
  const made = digest(value);
  keep(made, event);
  const created = new Part<T>({
    name,
    hash: made.hash,
    source: sourceOf(event.url),
    bytes: made.text.length,
    fetch,
    loaded: { value },
  });
  track(event.locals).parts.add(created);
  return created;
}

function current() {
  try {
    return getRequestEvent();
  } catch {
    return null;
  }
}

provide(() => {
  const event = current();
  if (event == null) {
    return null;
  }
  return {
    isData: event.isDataRequest,
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
      return made.hash;
    },
    outline: (identity, html, view) =>
      outlined(`${config.vary(event)}:${identity}`, html, view),
  };
});

function preload(html: string, found: { parts: Set<Part> }) {
  const at = html.indexOf("</head>");
  const links = found.parts
    .values()
    .filter((created) => created.fetch === "preload" && !created.isInline)
    .map(
      (created) =>
        `<link rel="preload" href="${settings.prefix}${created.hash}" as="fetch" crossorigin="anonymous">`,
    )
    .toArray();
  return at === -1 || links.length === 0
    ? html
    : `${html.slice(0, at)}${links.join("")}${html.slice(at)}`;
}

function inject(html: string, event: RequestEvent) {
  const found = requests.get(event.locals);
  if (found == null || found.isHeaded) {
    return html;
  }
  found.isHeaded = true;
  return preload(html, found);
}

async function shapes() {
  await recallAll();
  const all: Record<string, string> = {};
  for (const known of exemplars.values()) {
    Object.assign(all, flatten(known));
  }
  const text = JSON.stringify(all);
  return new Response(text, {
    headers: {
      "content-type": "application/json; charset=utf-8",
      "cache-control": "public, max-age=600, stale-while-revalidate=86400",
      etag: `"${hashOf(text)}"`,
    },
  });
}

async function rebuild(file: string, event: RequestEvent) {
  const source = event.url.searchParams.get("u");
  if (
    source == null ||
    !source.startsWith("/") ||
    source.startsWith("//") ||
    source.startsWith(settings.prefix)
  ) {
    return null;
  }
  const token = randomUUID();
  const found = new Map<string, Digest>();
  waiting.set(token, found);
  try {
    const target = new URL(source, event.url.origin);
    const data = file.endsWith(".html")
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
    return found.get(file)?.text ?? null;
  } finally {
    waiting.delete(token);
  }
}

async function respond(event: RequestEvent) {
  const file = event.url.pathname.slice(settings.prefix.length);
  const isRead = ["GET", "HEAD"].includes(event.request.method);
  if (isRead && file === SHAPES) {
    return shapes();
  }
  if (!isRead || !FILE.test(file)) {
    return new Response(null, { status: 404 });
  }
  const etag = `"${file}"`;
  if (event.request.headers.get("if-none-match") === etag) {
    return new Response(null, {
      status: 304,
      headers: { etag, "cache-control": IMMUTABLE },
    });
  }
  const text =
    recent.get(file) ??
    (await quietly(config.store?.get(`p:${file}`))) ??
    (await rebuild(file, event));
  if (text == null) {
    return new Response(null, {
      status: 404,
      headers: { "cache-control": "no-store" },
    });
  }
  return new Response(text, {
    headers: {
      "content-type": file.endsWith(".html")
        ? "text/html; charset=utf-8"
        : "application/json; charset=utf-8",
      "cache-control": IMMUTABLE,
      etag,
    },
  });
}

const handler: Handle = async ({ event, resolve }) => {
  if (event.url.pathname.startsWith(settings.prefix)) {
    return respond(event);
  }
  return resolve(event, {
    transformPageChunk: ({ html }) => inject(html, event),
  });
};

export function handle({
  store = null,
  memory = config.memory,
  prepare = () => {},
  vary = () => "",
}: {
  store?: Store | null;
  memory?: number;
  prepare?: Prepare;
  vary?: (event: RequestEvent) => string;
} = {}): Handle {
  config.store = store;
  config.memory = memory;
  config.prepare = prepare;
  config.vary = vary;
  return handler;
}
