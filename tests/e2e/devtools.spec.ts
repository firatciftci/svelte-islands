import type { Page } from "@playwright/test";
import { expect, test } from "@playwright/test";

const DEV = "http://127.0.0.1:5304";

test.setTimeout(60_000);

async function open(page: Page, path: string) {
  await page.goto(`${DEV}${path}`);
  await expect
    .poll(
      async () =>
        page.evaluate(() => document.documentElement.dataset.hydrated),
      { timeout: 30_000 },
    )
    .toBe("true");
}

test("a production build has no overlay", async ({ page }) => {
  await page.goto("/modes");
  await expect(page.locator("[data-islands-devtools]")).toHaveCount(0);
});

test("the overlay lists a page's islands with their state and size", async ({
  page,
}) => {
  await open(page, `/modes?seed=${crypto.randomUUID()}`);
  const pill = page.getByRole("button", { name: /^Islands 4/u });
  await pill.click();
  const panel = page.getByRole("region", { name: "Islands on this page" });
  await expect(panel).toBeVisible();
  const staticRow = panel.getByRole("row", { name: /static\.rows/u });
  await expect(staticRow).toContainText("static");
  await expect(staticRow).toContainText("KiB");
  const clientRow = panel.getByRole("row", { name: /client\.rows/u });
  await expect(clientRow).toContainText("client");

  await page.getByTestId("static-press").click();
  await expect(staticRow).toContainText("live");
  await expect(staticRow.getByRole("cell").nth(4)).toContainText("ms");
  await expect(panel.getByRole("listitem").first()).toContainText("hydrate");

  await panel.getByRole("button", { name: "Close" }).click();
  await expect(panel).toHaveCount(0);
  await expect(pill).toBeVisible();
});

test("the overlay outlines an island and jumps to it", async ({ page }) => {
  await open(page, `/modes?seed=${crypto.randomUUID()}`);
  await page.getByRole("button", { name: /^Islands 4/u }).click();
  const panel = page.getByRole("region", { name: "Islands on this page" });
  await panel.getByRole("button", { name: "deferred.rows" }).click();
  await expect(
    page.locator("[data-islands-devtools] .outline"),
  ).not.toHaveCount(0);
  await expect
    .poll(async () => page.evaluate(() => scrollY))
    .toBeGreaterThan(1000);
  await expect(page.getByTestId("deferred")).toBeVisible();
});

test("the overlay flags a skeleton that didn't match its content", async ({
  page,
}) => {
  const seed = crypto.randomUUID();
  await open(page, `/devtools?seed=${seed}&count=2`);
  await open(page, `/devtools?seed=${seed}&count=300`);
  await page.getByRole("button", { name: /^Islands 1/u }).click();
  const panel = page.getByRole("region", { name: "Islands on this page" });
  await panel.getByRole("button", { name: `devtools.rows.${seed}` }).click();
  await expect(panel).toContainText(/skeleton was \d+ px off/u);
  await expect(page.getByRole("button", { name: /to check/u })).toHaveCount(0);
  await panel.getByRole("button", { name: "Close" }).click();
  await expect(page.getByRole("button", { name: /1 to check/u })).toBeVisible();
});
