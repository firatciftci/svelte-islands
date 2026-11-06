import { resolve } from "node:path";
import { createTwoslasher } from "twoslash";
import ts from "typescript";

const REPOSITORY = resolve(process.cwd(), "..");
const WINDOW = ["lib.esnext.d.ts", "lib.dom.d.ts", "lib.dom.iterable.d.ts"];
const WORKER = ["lib.esnext.d.ts", "lib.webworker.d.ts"];

const IMPLIED = new Map([
  ["part", 'import { part } from "svelte-islands/server";'],
  ["islands", 'import { handle as islands } from "svelte-islands/server";'],
  ["serveParts", 'import { serveParts } from "svelte-islands/sw";'],
]);

const MISSING_NAME = new Set([2304, 2552]);
const MISSING_MODULE = 2307;
const MISSING_PROPERTY = 2339;
const LONGEST_TIP = 600;

function library(file: string) {
  return [resolve(REPOSITORY, "src/lib", file)];
}

const twoslash = createTwoslasher({
  vfsRoot: REPOSITORY,
  compilerOptions: {
    strict: true,
    noImplicitAny: false,
    allowJs: true,
    target: ts.ScriptTarget.ESNext,
    module: ts.ModuleKind.ESNext,
    moduleResolution: ts.ModuleResolutionKind.Bundler,
    types: ["@sveltejs/kit"],
    paths: {
      "svelte-islands/server": library("server.ts"),
      "svelte-islands/stores": library("stores.ts"),
      "svelte-islands/sw": library("sw.ts"),
      "svelte-islands/eslint": library("eslint.ts"),
      "svelte-islands": library("index.ts"),
    },
  },
  handbookOptions: { noErrorValidation: true },
});

function importsImpliedBy(code: string) {
  let imports = "";
  for (const [name, statement] of IMPLIED) {
    const isUsed = new RegExp(`\\b${name}\\(`, "u").test(code);
    const isImported = new RegExp(`^import .*\\b${name}\\b`, "mu").test(code);
    if (isUsed && !isImported) {
      imports += `${statement}\n`;
    }
  }
  return imports === "" ? "" : `${imports}// ---cut---\n`;
}

function isLeftToTheReader(code: number, text: string) {
  return (
    MISSING_NAME.has(code) ||
    (code === MISSING_MODULE && !/'(?:svelte-islands|\$lib)/u.test(text)) ||
    (code === MISSING_PROPERTY && text.includes("'Locals'"))
  );
}

function isWorthShowing(signature: string) {
  return (
    signature.length <= LONGEST_TIP &&
    !/\bany\b|^(?:var|import|\(method\)) /u.test(signature)
  );
}

function signatureOf(text: string) {
  const signature = text
    .replace(/^\((?:alias|property|parameter)\) /gmu, "")
    .replace(/\nimport \S+$/u, "")
    .replace(/\{[^{}]*\}(\??): \{/u, "options$1: {");
  const call = /^\w+(?:<(.*?)>)?\(/su.exec(signature);
  if (call == null) {
    return signature;
  }
  const argument = call[1];
  return `function ${
    argument?.includes("any") === true
      ? signature.replaceAll(argument, "T")
      : signature
  }`;
}

export function check(code: string, lang: string, file: string | null) {
  const result = twoslash(`${importsImpliedBy(code)}${code}`, lang, {
    compilerOptions: {
      lib: file?.includes("service-worker") === true ? WORKER : WINDOW,
    },
  });
  for (const error of result.errors) {
    if (!isLeftToTheReader(Number(error.code), error.text)) {
      throw new Error(
        `This code sample doesn't type-check: ${error.text}\n\n${code}`,
      );
    }
  }
  return {
    code: result.code,
    hovers: result.hovers.flatMap(({ line, character, length, text, docs }) => {
      const signature = signatureOf(text);
      return isWorthShowing(signature)
        ? [
            {
              line,
              character,
              length,
              signature,
              summary: docs?.split("\n\n")[0] ?? "",
            },
          ]
        : [];
    }),
  };
}
