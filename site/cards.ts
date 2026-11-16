import { mkdir, readdir, rm } from "node:fs/promises";
import { extname, join, relative } from "node:path";
import { chromium } from "@playwright/test";

const BUILD = new URL("build/", import.meta.url).pathname;
const SOURCE = join(BUILD, "card");
const OUTPUT = join(BUILD, "cards");
const BASE = process.env.BASE_PATH ?? "";
const ORIGIN = "http://cards.local";

async function pagesIn(directory: string): Promise<Array<string>> {
  const found: Array<string> = [];
  for (const entry of await readdir(directory, { withFileTypes: true })) {
    const path = join(directory, entry.name);
    if (entry.isDirectory()) {
      found.push(...(await pagesIn(path)));
    } else if (entry.name.endsWith(".html")) {
      found.push(relative(SOURCE, path).replace(/\.html$/u, ""));
    }
  }
  return found;
}

const slugs = await pagesIn(SOURCE);
const browser = await chromium.launch();
const page = await browser.newPage({
  viewport: { width: 1200, height: 630 },
  deviceScaleFactor: 2,
  colorScheme: "light",
});
await page.route(`${ORIGIN}/**`, async (route) => {
  const { pathname } = new URL(route.request().url());
  const inBuild = decodeURIComponent(pathname.slice(BASE.length));
  const file = join(
    BUILD,
    extname(inBuild) === "" ? `${inBuild}.html` : inBuild,
  );
  await route
    .fulfill({ path: file })
    .catch(() => route.fulfill({ status: 404 }));
});

for (const slug of slugs) {
  const target = join(OUTPUT, `${slug}.png`);
  await mkdir(join(target, ".."), { recursive: true });
  await page.goto(`${ORIGIN}${BASE}/card/${slug}`);
  await page.evaluate(() => document.fonts.ready);
  await page.screenshot({ path: target });
}

await browser.close();
await rm(SOURCE, { recursive: true });
await rm(`${SOURCE}.html`, { force: true });
console.log(`Drew ${slugs.length} cards`);
