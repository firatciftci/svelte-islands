import type { KnipConfig } from "knip";

const config: KnipConfig = {
  entry: [
    "fixtures/app/vite.config.ts",
    "fixtures/app/src/**/*",
    "fixtures/size-kit/vite.config.ts",
    "fixtures/size-kit/src/**/*",
    "site/vite.config.ts",
    "site/src/**/*",
    "site/bench/*.ts",
    "site/cards.ts",
    "tests/e2e/*.ts",
    "tests/stubs/*.ts",
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
