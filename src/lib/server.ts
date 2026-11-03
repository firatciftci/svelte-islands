import type { RequestEvent } from "@sveltejs/kit";
import type { Handle } from "@sveltejs/kit/hooks";
import { getRequestEvent } from "$app/server";
import { createHash, randomUUID } from "node:crypto";
import { render } from "svelte/server";
import Frame from "./frame.svelte";
import { Part, provide, quietly, serialize, settings } from "./part.js";
import { skeletonize } from "./skeleton.js";

export type Store = {
  get: (key: string) => Promise<string | null>;
  set: (key: string, text: string) => Promise<unknown>;
};

const TOKEN = "x-svelte-islands-token";
const SCRIPT = "svelte-islands-skeletons";
const HASH = /^[\w-]{22}$/u;
const RELEARN = 10 * 60_000;
const IMMUTABLE = "public, max-age=31536000, immutable";

type Digest = { text: string; hash: string };

const digests = new WeakMap<object, Digest>();
const recent = new Map<string, string>();
const exemplars = new Map<string, Map<string, { html: string; at: number }>>();
const asked = new Set<string>();
const waiting = new Map<string, Map<string, Digest>>();
const requests = new WeakMap<
  object,
  { parts: Set<Part>; rendered: Set<string> }
>();
type Prepare = (
  request: { url: URL; headers: Headers },
  event: RequestEvent,
) => void;

const config: { store: Store | null; memory: number; prepare: Prepare } = {
  store: null,
  memory: 64 * 1024 ** 2,
  prepare: () => {},
};
const state = { held: 0 };

function digest(value: unknown) {
  const isObject = typeof value === "object" && value != null;
  const known = isObject ? digests.get(value) : undefined;
  if (known != null) {
    return known;
  }
  const text = serialize(value);
  const made = {
    text,
    hash: createHash("sha256").update(text).digest("base64url").slice(0, 22),
  };
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

function track(locals: object) {
  let found = requests.get(locals);
  if (found == null) {
    found = { parts: new Set(), rendered: new Set() };
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

function learn(name: string, key: string, html: string) {
  const known = examplesOf(name);
  const found = known.get(key);
  if (found != null && Date.now() - found.at < RELEARN) {
    return;
  }
  const shaped = skeletonize(html);
  if (shaped == null || shaped === "") {
    return;
  }
  known.set(key, { html: shaped, at: Date.now() });
  if (found?.html !== shaped) {
    void quietly(
      config.store?.set(`skeletons:${name}`, JSON.stringify(flatten(known))),
    );
  }
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

function skeletonsOf(name: string) {
  void recall(name);
  const known = exemplars.get(name);
  return known == null || known.size === 0 ? null : flatten(known);
}

export function part<T>(name: string, value: T) {
  const event = getRequestEvent();
  const made = digest(value);
  if (hold(made)) {
    void quietly(config.store?.set(`p:${made.hash}`, made.text));
  }
  const token = event.request.headers.get(TOKEN);
  if (token != null) {
    waiting.get(token)?.set(made.hash, made);
  }
  const created = new Part<T>({
    name,
    hash: made.hash,
    source: sourceOf(event.url),
    bytes: made.text.length,
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
    rendered: (rendered, key, html) => {
      track(event.locals).rendered.add(key);
      learn(rendered.name, key, html);
    },
    exemplars: skeletonsOf,
  };
});

function inject(html: string, event: RequestEvent) {
  const found = requests.get(event.locals);
  if (found == null) {
    return html;
  }
  const wanted: Record<string, string> = {};
  for (const created of found.parts) {
    if (created.isInline) {
      continue;
    }
    const known = Object.entries(skeletonsOf(created.name) ?? {});
    for (const [key, shaped] of known) {
      if (!found.rendered.has(key)) {
        wanted[key] = shaped;
      }
    }
  }
  if (Object.keys(wanted).length === 0) {
    return html;
  }
  const script = `<script type="application/json" id="${SCRIPT}">${JSON.stringify(wanted).replaceAll("<", String.raw`\u003c`)}</script>`;
  const at = html.lastIndexOf("</body>");
  return at === -1
    ? `${html}${script}`
    : `${html.slice(0, at)}${script}${html.slice(at)}`;
}

async function rebuild(hash: string, event: RequestEvent) {
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
    const data = new URL(
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
    return found.get(hash)?.text ?? null;
  } finally {
    waiting.delete(token);
  }
}

async function respond(event: RequestEvent) {
  const hash = event.url.pathname.slice(settings.prefix.length);
  if (!["GET", "HEAD"].includes(event.request.method) || !HASH.test(hash)) {
    return new Response(null, { status: 404 });
  }
  const etag = `"${hash}"`;
  if (event.request.headers.get("if-none-match") === etag) {
    return new Response(null, {
      status: 304,
      headers: { etag, "cache-control": IMMUTABLE },
    });
  }
  const text =
    recent.get(hash) ??
    (await quietly(config.store?.get(`p:${hash}`))) ??
    (await rebuild(hash, event));
  if (text == null) {
    return new Response(null, {
      status: 404,
      headers: { "cache-control": "no-store" },
    });
  }
  return new Response(text, {
    headers: {
      "content-type": "application/json; charset=utf-8",
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
    transformPageChunk: ({ html, done }) => (done ? inject(html, event) : html),
  });
};

export function handle({
  store = null,
  memory = config.memory,
  prepare = () => {},
}: { store?: Store | null; memory?: number; prepare?: Prepare } = {}): Handle {
  config.store = store;
  config.memory = memory;
  config.prepare = prepare;
  return handler;
}
