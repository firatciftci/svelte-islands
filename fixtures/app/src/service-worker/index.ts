import { version } from "$app/env";
import { assets, immutable } from "$app/manifest";
import { self } from "$app/service-worker";
import { serveParts } from "svelte-islands/sw";

const ASSETS = `assets-${version}`;
const PAGES = "pages";
const FILES = [...immutable, ...assets].map((file) => file.path);

self.addEventListener("install", (event) => {
  async function store() {
    const cache = await caches.open(ASSETS);
    await cache.addAll(FILES);
  }
  event.waitUntil(store());
});

self.addEventListener("activate", (event) => {
  event.waitUntil(self.clients.claim());
});

async function assetOrPage(request: Request) {
  const asset = await caches.match(request);
  if (asset != null) {
    return asset;
  }
  const pages = await caches.open(PAGES);
  try {
    const response = await fetch(request);
    if (response.ok) {
      await pages.put(request, response.clone());
    }
    return response;
  } catch (error) {
    const page = await pages.match(request);
    if (page == null) {
      throw error;
    }
    return page;
  }
}

self.addEventListener("fetch", (event) => {
  if (serveParts(event) || event.request.method !== "GET") {
    return;
  }
  if (new URL(event.request.url).origin === location.origin) {
    event.respondWith(assetOrPage(event.request));
  }
});
