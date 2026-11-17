import type { Page } from "@playwright/test";
import { expect } from "@playwright/test";

export function watchErrors(page: Page) {
  const errors: Array<string> = [];
  page.on("pageerror", (error) => {
    errors.push(error.message);
  });
  page.on("console", (message) => {
    if (message.type() === "error" || message.text().includes("hydration")) {
      errors.push(message.text());
    }
  });
  return errors;
}

export function partRequests(page: Page) {
  const urls: Array<string> = [];
  page.on("request", (request) => {
    if (request.url().includes("/_parts/")) {
      urls.push(request.url());
    }
  });
  return urls;
}

export async function reach(page: Page, testId: string) {
  const island = page.getByTestId(testId);
  await expect(async () => {
    await page.evaluate(() => {
      const isAtEnd =
        scrollY + innerHeight >= document.documentElement.scrollHeight - 1;
      scrollTo(0, isAtEnd ? 0 : scrollY + innerHeight);
    });
    await expect(island).toBeVisible({ timeout: 100 });
  }).toPass({ intervals: [50], timeout: 25_000 });
  return island;
}

export async function hydrated(page: Page) {
  await page.waitForFunction(
    () => document.documentElement.dataset.hydrated === "true",
  );
}

export async function observed(page: Page) {
  return page.evaluate(
    () =>
      (
        globalThis as unknown as {
          islandEvents: Array<Record<string, unknown>>;
        }
      ).islandEvents,
  );
}
