import type { Page } from "@playwright/test";
import { expect, test } from "@playwright/test";

function watchErrors(page: Page) {
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

async function hydrated(page: Page) {
  await page.waitForFunction(
    () => document.documentElement.dataset.hydrated === "true",
  );
}

async function watchSkeleton(page: Page) {
  await page.evaluate(() => {
    const look = () => {
      for (const bone of document.querySelectorAll(
        ".body-wrap .island-delayed > *",
      )) {
        if (getComputedStyle(bone).visibility === "visible") {
          document.documentElement.dataset.sawSkeleton = "";
        }
      }
      requestAnimationFrame(look);
    };
    look();
  });
}

async function sawSkeleton(page: Page) {
  return page.evaluate(
    () => document.documentElement.dataset.sawSkeleton != null,
  );
}

test.describe("stream()", () => {
  test("a hard load renders quick values and streams slow ones", async ({
    page,
    request,
  }) => {
    const response = await request.get("/streaming?topic=a");
    const html = await response.text();
    expect(html).toContain("quick a 1");
    expect(html).not.toContain('data-testid="body"');
    expect(response.headers()["cache-control"]).toBe("private, no-cache");

    const errors = watchErrors(page);
    await page.goto("/streaming?topic=a");
    await expect(page.getByTestId("body")).toContainText("line 80 of a");
    await hydrated(page);
    expect(errors).toStrictEqual([]);
  });

  test("a rejected value shows the failed snippet", async ({ page }) => {
    await page.goto("/streaming?topic=a&broken");
    await expect(page.getByTestId("failed")).toBeVisible();
    await expect(page.getByTestId("body")).toContainText("line 80 of a");
  });

  test("an unlimited budget renders everything and stays shareable", async ({
    request,
  }) => {
    const response = await request.get("/streaming?topic=a&full");
    const html = await response.text();
    expect(html).toContain('data-testid="body"');
    expect(response.headers()["cache-control"]).toBeUndefined();
  });

  test("a streamed region learns its skeleton on the server", async ({
    request,
  }) => {
    await (await request.get("/streaming?topic=a")).text();
    const html = await (await request.get("/streaming?topic=a")).text();
    const at = html.indexOf("body-wrap");
    expect(at).toBeGreaterThan(-1);
    expect(html.slice(at, at + 2000)).toContain("island-bone");
    expect(html.slice(at, at + 2000)).not.toContain("<header");
  });
});

test.describe("Await", () => {
  test("the same key keeps the old content, marked busy", async ({ page }) => {
    const errors = watchErrors(page);
    await page.goto("/streaming?topic=a");
    await hydrated(page);
    await expect(page.getByTestId("body")).toHaveAttribute("data-view", "1");
    await page.getByTestId("same").click();
    const wrap = page.locator(".body-wrap");
    await expect(wrap).toHaveAttribute("aria-busy", "true");
    await expect(wrap).toHaveAttribute("data-island-stale", "");
    await expect(page.getByTestId("body")).toHaveAttribute("data-view", "1");
    await expect(wrap.locator(".island-shell")).toHaveCount(0);
    await expect(page.getByTestId("body")).toHaveAttribute("data-view", "2");
    await expect(wrap).not.toHaveAttribute("aria-busy", "true");
    expect(errors).toStrictEqual([]);
  });

  test("a pending snippet shows at once, around the skeleton", async ({
    page,
    request,
  }) => {
    const html = await (await request.get("/streaming?topic=a")).text();
    expect(html).toContain("Waiting for a");
    await page.goto("/streaming?topic=a");
    await hydrated(page);
    await expect(page.getByTestId("body")).toContainText("of a");
    await expect(page.getByTestId("standin")).toHaveCount(0);
    await page.getByTestId("other").click();
    await expect(page.getByTestId("standin")).toHaveText("Waiting for b");
    await expect(page.locator(".body-wrap .island-shell")).toHaveCount(1);
    await expect(page.getByTestId("body")).toContainText("line 1 of b");
    await expect(page.getByTestId("standin")).toHaveCount(0);
  });

  test("a new key shows the skeleton, then the content", async ({ page }) => {
    await page.goto("/streaming?topic=a");
    await hydrated(page);
    await expect(page.getByTestId("body")).toContainText("of a");
    await watchSkeleton(page);
    await page.getByTestId("other").click();
    await expect(page.locator(".body-wrap .island-shell")).toHaveCount(1);
    await expect(page.getByTestId("body")).toContainText("line 1 of b");
    expect(await sawSkeleton(page)).toBe(true);
  });

  test("data that arrives within the delay never shows a skeleton", async ({
    page,
  }) => {
    await page.goto("/streaming?topic=a");
    await hydrated(page);
    await expect(page.getByTestId("body")).toContainText("of a");
    await watchSkeleton(page);
    await page.getByTestId("soon").click();
    await expect(page.getByTestId("body")).toContainText("line 1 of c");
    expect(await sawSkeleton(page)).toBe(false);
  });

  test("a hash inside streamed content is scrolled to once it arrives", async ({
    page,
  }) => {
    await page.goto("/streaming?topic=a");
    await hydrated(page);
    await page.getByTestId("deep").click();
    await expect(page.getByTestId("body")).toContainText("of d");
    await expect(page.locator("#deep")).toBeInViewport();
  });

  test("a hard load with a hash scrolls to it once it arrives", async ({
    page,
  }) => {
    await page.goto("/streaming?topic=e#deep");
    await expect(page.getByTestId("body")).toContainText("of e");
    await expect(page.locator("#deep")).toBeInViewport();
  });
});
