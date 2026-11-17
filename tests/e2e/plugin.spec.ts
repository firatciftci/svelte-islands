import { expect, test } from "@playwright/test";
import { hydrated, watchErrors } from "./helpers.ts";

const isSplit = process.env.FIXTURE_PLUGIN !== "0";

function seeded(path: string) {
  return `${path}?seed=${crypto.randomUUID()}`;
}

test.describe("captured page values", () => {
  test("an island reads and writes page state through its scope", async ({
    page,
  }) => {
    const errors = watchErrors(page);
    await page.goto(seeded("/scope"));
    await hydrated(page);
    await expect(page.getByTestId("page-state")).toHaveText("0|Ada|1");
    await page.getByTestId("island-bump").click();
    await expect(page.getByTestId("island-count")).toHaveText("1");
    await expect(page.getByTestId("page-state")).toHaveText("1|Ada|1");
    await page.getByTestId("page-bump").click();
    await expect(page.getByTestId("island-count")).toHaveText("2");
    await expect(page.getByTestId("badge")).toHaveText("DECK 4");
    await page.getByLabel("Island name").fill("Grace");
    await expect(page.getByTestId("page-state")).toHaveText("2|Grace|1");
    await page.getByTestId("tally").click();
    await expect(page.getByTestId("tally")).toHaveText("2");
    await expect(page.getByTestId("page-state")).toHaveText("2|Grace|2");
    await expect(page.getByTestId("length")).toHaveText("300");
    expect(errors).toStrictEqual([]);
  });

  test("islands inside an each block keep their item and index", async ({
    page,
  }) => {
    await page.goto(seeded("/scope"));
    await hydrated(page);
    await expect(page.getByTestId("group-north")).toHaveText("north 0 scope 0");
    await expect(page.getByTestId("group-south")).toHaveText("south 1 scope 0");
  });

  test("each island's code waits for the island when nothing prefetches it", async ({
    page,
  }) => {
    test.skip(!isSplit, "needs the Vite plugin");
    await page.addInitScript(() => {
      Object.defineProperty(navigator, "connection", {
        value: { saveData: true },
      });
    });
    const scripts: Array<string> = [];
    page.on("response", async (response) => {
      if (response.url().endsWith(".js")) {
        scripts.push(await response.text());
      }
    });
    await page.goto(seeded("/scope"));
    await hydrated(page);
    await page.waitForLoadState("networkidle");
    expect(scripts.some((script) => script.includes("island-bump"))).toBe(
      false,
    );
    await page.getByTestId("island-bump").click();
    await expect(page.getByTestId("island-count")).toHaveText("1");
    await expect
      .poll(() => scripts.some((script) => script.includes("island-bump")))
      .toBe(true);
  });
});

test.describe("islands the plugin leaves in the page", () => {
  test("markup that uses the page's scoped styles keeps them", async ({
    page,
  }) => {
    await page.goto(seeded("/styled"));
    await hydrated(page);
    const button = page.getByTestId("styled");
    await expect(button).toHaveCSS("color", "rgb(200, 0, 0)");
    await button.click();
    await expect(button).toHaveText("300 1");
    await expect(button).toHaveCSS("color", "rgb(200, 0, 0)");
  });
});

test("an island whose part stays in the page hydrates without a mismatch", async ({
  page,
}) => {
  const errors = watchErrors(page);
  await page.addInitScript(() => {
    document.addEventListener("DOMContentLoaded", () => {
      Object.assign(globalThis, {
        serverSmall: document.querySelector("[data-testid=small]"),
      });
    });
  });
  await page.goto(seeded("/scope"));
  await hydrated(page);
  const small = page.getByTestId("small");
  await expect(small).toHaveText("3 0");
  await small.click();
  await expect(small).toHaveText("3 1");
  await expect(page.getByTestId("page-state")).toHaveText("1|Ada|1");
  const isKept = await page.evaluate(
    () =>
      (globalThis as unknown as { serverSmall: Element | null }).serverSmall
        ?.isConnected === true,
  );
  expect(isKept).toBe(true);
  expect(errors).toStrictEqual([]);
});
