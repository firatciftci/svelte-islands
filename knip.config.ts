import type { KnipConfig } from "knip";

const config: KnipConfig = {
  entry: [
    "fixtures/app/vite.config.ts",
    "fixtures/app/src/**/*",
    "site/vite.config.ts",
    "site/src/**/*",
    "site/bench/*.ts",
    "tests/e2e/*.ts",
  ],
  ignoreFiles: [
    "changelogithub.config.ts",
    "fixtures/app/async/**",
    "fixtures/app/workers/**",
  ],
  ignoreDependencies: [/^@fontsource-variable\//u],
  ignoreUnresolved: ["#waiting"],
  ignoreIssues: { ".github/**/*.yml": ["binaries"] },
  treatConfigHintsAsErrors: true,
};

export default config;
