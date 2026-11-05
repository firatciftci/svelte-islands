import { defineConfig } from "@playwright/test";

const chromium = process.env.PLAYWRIGHT_CHROMIUM_PATH;
const isShared = process.env.FIXTURE_STORE === "r2";
const A = 5301;
const B = 5302;

function worker(port: number) {
  return {
    command: `npx wrangler dev --port ${port} --ip 127.0.0.1 --persist-to .wrangler/shared --log-level warn --show-interactive-dev-session=false`,
    cwd: "fixtures/app",
    port,
    reuseExistingServer: false,
    timeout: 60_000,
    env: { WRANGLER_SEND_METRICS: "false" },
  };
}

export default defineConfig({
  testDir: "tests/e2e",
  testMatch: ["islands.spec.ts", "workers.spec.ts"],
  grepInvert: isShared
    ? /static host|another server rebuilds/u
    : /static host/u,
  fullyParallel: true,
  forbidOnly: true,
  retries: 0,
  reporter: [["list"]],
  use: {
    baseURL: `http://127.0.0.1:${A}`,
    ...(chromium != null && { launchOptions: { executablePath: chromium } }),
  },
  webServer: [worker(A), worker(B)],
});
