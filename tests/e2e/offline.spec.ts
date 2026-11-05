import type { Page } from "@playwright/test";
import { expect, test } from "@playwright/test";
import { spawn } from "node:child_process";
import { once } from "node:events";

const PORT = 5310;
const BASE = `http://127.0.0.1:${PORT}`;

async function serve() {
  const server = spawn("node", ["fixtures/app/build/index.js"], {
    env: {
      ...process.env,
      PORT: String(PORT),
      HOST: "127.0.0.1",
      ORIGIN: BASE,
    },
    stdio: "ignore",
  });
  await expect(async () => {
    expect((await fetch(`${BASE}/`)).ok).toBe(true);
  }).toPass({ intervals: [50], timeout: 10_000 });
  return server;
}

async function reachLater(page: Page) {
  await expect(async () => {
    await page.evaluate(() => {
      scrollTo(0, document.documentElement.scrollHeight);
    });
    await expect(page.getByTestId("later")).toBeVisible({ timeout: 100 });
  }).toPass({ intervals: [50], timeout: 10_000 });
}

test("a page visited once still works with the server gone", async ({
  page,
}) => {
  const server = await serve();
  const stopped = once(server, "exit");
  try {
    await page.goto(`${BASE}/offline`);
    await page.waitForFunction(
      () => document.documentElement.dataset.hydrated === "true",
    );
    await expect(page.getByTestId("controlled")).toHaveText("Controlled");

    await page.reload();
    await page.waitForFunction(
      () => document.documentElement.dataset.hydrated === "true",
    );
    await page.getByTestId("offline-press").click();
    await reachLater(page);
    await page.getByTestId("later-press").click();
    await expect
      .poll(async () =>
        page.evaluate(async () => {
          const cache = await caches.open("svelte-islands-parts");
          return (await cache.keys()).length;
        }),
      )
      .toBeGreaterThanOrEqual(3);

    server.kill();
    await stopped;

    await page.reload();
    await page.waitForFunction(
      () => document.documentElement.dataset.hydrated === "true",
    );
    await expect(page.getByTestId("offline")).toBeVisible();
    await page.getByTestId("offline-press").click();
    await expect(page.getByTestId("offline-press")).toHaveText("pressed 1");
    await reachLater(page);
  } finally {
    server.kill();
  }
});
