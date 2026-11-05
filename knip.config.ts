import type { KnipConfig } from "knip";

const config: KnipConfig = {
  entry: [
    "fixtures/app/vite.config.ts",
    "fixtures/app/src/**/*",
    "tests/e2e/*.ts",
  ],
  ignoreFiles: ["changelogithub.config.ts", "fixtures/app/async/**"],
  ignoreUnresolved: ["#waiting"],
  ignoreIssues: { ".github/**/*.yml": ["binaries"] },
  treatConfigHintsAsErrors: true,
};

export default config;
