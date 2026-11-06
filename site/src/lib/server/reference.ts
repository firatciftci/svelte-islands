import ts from "typescript";
import manifest from "../../../../package.json";
import type { Heading, Segment } from "./markdown";

type Rendered = { segments: Array<Segment>; headings: Array<Heading> };
type Doc = {
  text: string;
  params: Map<string, string>;
  returns: string | null;
};
type Export =
  | { name: string; kind: "component"; file: string }
  | {
      name: string;
      kind: "function";
      file: string;
      node: ts.SignatureDeclaration;
      host: ts.Node;
    }
  | { name: string; kind: "class"; file: string; node: ts.ClassDeclaration }
  | { name: string; kind: "type"; file: string; node: ts.TypeAliasDeclaration }
  | { name: string; kind: "plugin"; file: string; node: ts.ExportAssignment };

const ROOT = "../../../../src/lib/";
const WIDTH = 72;
const ORDER = ["component", "function", "class", "type"];
const OPENS = /[{[]$/u;
const CLOSES = /^\s*[}\]]/u;

const files = import.meta.glob("../../../../src/lib/*.{ts,svelte}", {
  query: "?raw",
  import: "default",
  eager: true,
}) as Record<string, string>;

const printer = ts.createPrinter({ removeComments: true });
const parsed = new Map<string, ts.SourceFile>();
const problems: Array<string> = [];

function textOf(file: string) {
  const text = files[`${ROOT}${file}`];
  if (text == null) {
    throw new Error(`reference: no source file ${file}`);
  }
  return text;
}

function parse(file: string) {
  const known = parsed.get(file);
  if (known != null) {
    return known;
  }
  const text = textOf(file);
  const script = file.endsWith(".svelte")
    ? (/<script\b[^>]*>([\s\S]*?)<\/script>/u.exec(text)?.[1] ?? "")
    : text;
  const source = ts.createSourceFile(
    file,
    script,
    ts.ScriptTarget.Latest,
    true,
    ts.ScriptKind.TS,
  );
  parsed.set(file, source);
  return source;
}

function readLines(lines: Array<string>): Doc {
  const text: Array<string> = [];
  const params = new Map<string, Array<string>>();
  let returns: Array<string> | null = null;
  let current = text;
  let inFence = false;
  for (const line of lines) {
    if (line.trimStart().startsWith("```")) {
      inFence = !inFence;
    }
    const param = inFence ? null : /^@param\s+(\S+)\s*(.*)$/u.exec(line);
    const result = inFence ? null : /^@returns\s+(.*)$/u.exec(line);
    if (param != null) {
      current = [param[2] ?? ""];
      params.set(param[1] ?? "", current);
    } else if (result != null) {
      current = [result[1] ?? ""];
      returns = current;
    } else {
      current.push(line);
    }
  }
  const joined = new Map<string, string>();
  for (const [name, words] of params) {
    joined.set(name, words.join(" ").replaceAll(/\s+/gu, " ").trim());
  }
  return {
    text: text.join("\n").trim(),
    params: joined,
    returns: returns?.join(" ").replaceAll(/\s+/gu, " ").trim() ?? null,
  };
}

function docOf(node: ts.Node, source: ts.SourceFile) {
  const comment = ts.getJSDocCommentsAndTags(node).filter(ts.isJSDoc).at(-1);
  if (comment == null) {
    return null;
  }
  return readLines(
    comment
      .getText(source)
      .replace(/^\/\*\*/u, "")
      .replace(/\*\/$/u, "")
      .split("\n")
      .map((line) => line.replace(/^\s*\* ?/u, "")),
  );
}

function printed(node: ts.Node, source: ts.SourceFile) {
  return printer
    .printNode(ts.EmitHint.Unspecified, node, source)
    .replace(/^export /u, "")
    .replaceAll(/^ +/gmu, (spaces) => spaces.slice(spaces.length / 2));
}

function flatten(text: string, room = WIDTH): string {
  const lines = text.split("\n");
  for (const [at, open] of lines.entries()) {
    if (!OPENS.test(open)) {
      continue;
    }
    const rest = lines.slice(at + 1);
    const end = rest.findIndex((line) => CLOSES.test(line) || OPENS.test(line));
    const close = rest[end] ?? "";
    if (CLOSES.test(close)) {
      const inner = rest
        .slice(0, end)
        .map((line) => line.trim())
        .join(" ")
        .replace(/;$/u, "");
      const flat = open.endsWith("[")
        ? `${open}${inner}${close.trim()}`
        : `${open} ${inner} ${close.trim()}`;
      if (flat.length <= room) {
        lines.splice(at, end + 2, flat);
        return flatten(lines.join("\n"), room);
      }
    }
  }
  return text;
}

function indent(text: string) {
  return text.replaceAll(/^/gmu, "  ");
}

function topConst(source: ts.SourceFile, name: string) {
  for (const statement of source.statements) {
    if (ts.isVariableStatement(statement)) {
      for (const declaration of statement.declarationList.declarations) {
        if (
          ts.isIdentifier(declaration.name) &&
          declaration.name.text === name
        ) {
          return declaration.initializer ?? null;
        }
      }
    }
  }
  return null;
}

function unwrap(node: ts.Expression): ts.Expression {
  return ts.isSatisfiesExpression(node) || ts.isAsExpression(node)
    ? unwrap(node.expression)
    : node;
}

function propertyOf(node: ts.Expression | null | undefined, name: string) {
  if (node == null) {
    return null;
  }
  const object = unwrap(node);
  if (ts.isObjectLiteralExpression(object)) {
    for (const property of object.properties) {
      if (
        ts.isPropertyAssignment(property) &&
        (ts.isIdentifier(property.name) || ts.isStringLiteral(property.name)) &&
        property.name.text === name
      ) {
        return property.initializer;
      }
    }
  }
  return null;
}

function literal(
  node: ts.Expression | undefined,
  source: ts.SourceFile,
): string | null {
  if (node == null) {
    return null;
  }
  if (
    ts.isStringLiteral(node) ||
    ts.isNumericLiteral(node) ||
    node.kind === ts.SyntaxKind.TrueKeyword ||
    node.kind === ts.SyntaxKind.FalseKeyword ||
    node.kind === ts.SyntaxKind.NullKeyword
  ) {
    return node.getText(source);
  }
  if (ts.isIdentifier(node)) {
    return literal(topConst(source, node.text) ?? undefined, source);
  }
  if (ts.isPropertyAccessExpression(node) && ts.isIdentifier(node.expression)) {
    const found = propertyOf(
      topConst(source, node.expression.text),
      node.name.text,
    );
    return literal(found ?? undefined, source);
  }
  return null;
}

function withDefault(text: string, value: string | null | undefined) {
  return value == null || /default/iu.test(text)
    ? text
    : `${text} The default is \`${value}\`.`;
}

function aliasOf(source: ts.SourceFile, name: string) {
  for (const statement of source.statements) {
    if (ts.isTypeAliasDeclaration(statement) && statement.name.text === name) {
      return statement;
    }
  }
  return null;
}

function isExported(statement: ts.Statement) {
  return (
    ts.canHaveModifiers(statement) &&
    ts
      .getModifiers(statement)
      ?.some(({ kind }) => kind === ts.SyntaxKind.ExportKeyword) === true
  );
}

function aliasText(alias: ts.TypeAliasDeclaration, source: ts.SourceFile) {
  const flat = flatten(printed(alias, source));
  if (!ts.isFunctionTypeNode(alias.type) || !flat.includes("\n")) {
    return flat;
  }
  const parameters = alias.type.parameters
    .map((parameter) => indent(`${flatten(printed(parameter, source))},`))
    .join("\n");
  const result = printed(alias.type.type, source);
  return `type ${alias.name.text} = (\n${parameters}\n) => ${result};`;
}

function localTypes(nodes: Array<ts.Node>, source: ts.SourceFile) {
  const found = new Map<string, string>();
  function visit(node: ts.Node) {
    if (ts.isTypeReferenceNode(node) && ts.isIdentifier(node.typeName)) {
      const alias = aliasOf(source, node.typeName.text);
      if (alias != null && !isExported(alias) && !found.has(alias.name.text)) {
        found.set(alias.name.text, aliasText(alias, source));
        visit(alias.type);
      }
    }
    ts.forEachChild(node, visit);
  }
  for (const node of nodes) {
    visit(node);
  }
  return [...found.values()];
}

function moduleFile(specifier: string) {
  const name = specifier.replace(/^\.\//u, "");
  return name.endsWith(".js") ? `${name.slice(0, -3)}.ts` : name;
}

function ownExports(statement: ts.Statement, file: string): Array<Export> {
  if (ts.isExportAssignment(statement)) {
    return [{ name: "default", kind: "plugin", file, node: statement }];
  }
  if (!isExported(statement)) {
    return [];
  }
  if (ts.isFunctionDeclaration(statement) && statement.name != null) {
    return [
      {
        name: statement.name.text,
        kind: "function",
        file,
        node: statement,
        host: statement,
      },
    ];
  }
  if (ts.isClassDeclaration(statement) && statement.name != null) {
    return [
      { name: statement.name.text, kind: "class", file, node: statement },
    ];
  }
  if (ts.isTypeAliasDeclaration(statement)) {
    return [{ name: statement.name.text, kind: "type", file, node: statement }];
  }
  if (!ts.isVariableStatement(statement)) {
    return [];
  }
  const found: Array<Export> = [];
  for (const declaration of statement.declarationList.declarations) {
    if (
      ts.isIdentifier(declaration.name) &&
      declaration.initializer != null &&
      ts.isArrowFunction(declaration.initializer)
    ) {
      found.push({
        name: declaration.name.text,
        kind: "function",
        file,
        node: declaration.initializer,
        host: statement,
      });
    }
  }
  return found;
}

function exportsOf(file: string): Array<Export> {
  if (file.endsWith(".svelte")) {
    return [{ name: "default", kind: "component", file }];
  }
  const found: Array<Export> = [];
  for (const statement of parse(file).statements) {
    if (
      ts.isExportDeclaration(statement) &&
      statement.moduleSpecifier != null &&
      ts.isStringLiteral(statement.moduleSpecifier) &&
      statement.exportClause != null &&
      ts.isNamedExports(statement.exportClause)
    ) {
      const target = exportsOf(moduleFile(statement.moduleSpecifier.text));
      for (const element of statement.exportClause.elements) {
        const inner = (element.propertyName ?? element.name).text;
        const match = target.find(({ name }) => name === inner);
        if (match == null) {
          throw new Error(`reference: ${file} re-exports a missing ${inner}`);
        }
        found.push({ ...match, name: element.name.text });
      }
    } else {
      found.push(...ownExports(statement, file));
    }
  }
  return found;
}

function code(lines: Array<string>, lang = "ts") {
  return `\`\`\`${lang}\n${lines.join("\n\n")}\n\`\`\``;
}

function joinBlocks(blocks: Array<string>) {
  return blocks.filter((block) => block !== "").join("\n\n");
}

function splitLead(text: string) {
  const at = text.indexOf("\n\n");
  return at === -1
    ? { lead: text, rest: "" }
    : { lead: text.slice(0, at), rest: text.slice(at + 2) };
}

function bulletList(entries: Array<{ name: string; text: string }>) {
  return entries.map(({ name, text }) => `- \`${name}\`: ${text}`).join("\n");
}

function returnsLine(doc: Doc) {
  if (doc.returns == null) {
    return "";
  }
  const text = /^(?:[A-Z][a-z]|A )/u.test(doc.returns)
    ? `${doc.returns[0]?.toLowerCase()}${doc.returns.slice(1)}`
    : doc.returns;
  return `Returns ${text}`;
}

function labelsOf(node: ts.SignatureDeclaration, doc: Doc) {
  const named = [...doc.params.keys()];
  return node.parameters.map((parameter, at) =>
    ts.isIdentifier(parameter.name)
      ? parameter.name.text
      : (named[at] ?? "options"),
  );
}

function optionDocs(
  name: string,
  node: ts.SignatureDeclaration,
  labels: Array<string>,
  source: ts.SourceFile,
) {
  const docs = new Map<string, string>();
  for (const [at, parameter] of node.parameters.entries()) {
    if (parameter.type == null || !ts.isTypeLiteralNode(parameter.type)) {
      continue;
    }
    for (const member of parameter.type.members) {
      const key = `${labels[at] ?? "options"}.${memberName(member, source)}`;
      const text = docOf(member, source)?.text;
      if (text == null) {
        problems.push(`${name}: no TSDoc for ${key}`);
      } else {
        docs.set(key, text);
      }
    }
  }
  return docs;
}

function defaultsOf(
  node: ts.SignatureDeclaration,
  labels: Array<string>,
  source: ts.SourceFile,
) {
  const defaults = new Map<string, string | null>();
  for (const [at, parameter] of node.parameters.entries()) {
    const label = labels[at] ?? "options";
    if (ts.isObjectBindingPattern(parameter.name)) {
      for (const element of parameter.name.elements) {
        const name = (element.propertyName ?? element.name).getText(source);
        defaults.set(`${label}.${name}`, literal(element.initializer, source));
      }
    } else {
      defaults.set(label, literal(parameter.initializer, source));
    }
  }
  return defaults;
}

function signature(
  name: string,
  node: ts.SignatureDeclaration,
  labels: Array<string>,
  source: ts.SourceFile,
) {
  const generics =
    node.typeParameters == null
      ? ""
      : `<${node.typeParameters.map((type) => type.getText(source)).join(", ")}>`;
  if (node.type == null) {
    problems.push(`${name} has no return type`);
  }
  const result =
    node.type == null ? "void" : flatten(printed(node.type, source));
  const parameters = node.parameters.map((parameter, at) => {
    const optional =
      parameter.questionToken != null || parameter.initializer != null;
    const type =
      parameter.type == null ? "unknown" : printed(parameter.type, source);
    const label = `${labels[at] ?? "options"}${optional ? "?" : ""}: `;
    return `${label}${flatten(type, WIDTH - 2 - label.length)}`;
  });
  const flat = `function ${name}${generics}(${parameters.join(", ")}): ${result};`;
  const isOneLine = !parameters.some((parameter) => parameter.includes("\n"));
  if (isOneLine && (flat.split("\n")[0] ?? "").length <= WIDTH) {
    return flat;
  }
  const lines = parameters.map((parameter) => indent(parameter)).join(",\n");
  return `function ${name}${generics}(\n${lines},\n): ${result};`;
}

function functionBody(
  name: string,
  entry: Extract<Export, { kind: "function" }>,
) {
  const source = parse(entry.file);
  const doc = docOf(entry.host, source);
  if (doc == null) {
    problems.push(`${name} has no TSDoc`);
    return "";
  }
  const labels = labelsOf(entry.node, doc);
  const defaults = defaultsOf(entry.node, labels, source);
  const params = new Map([
    ...doc.params,
    ...optionDocs(name, entry.node, labels, source),
  ]);
  const keys = [...params.keys()];
  for (const key of defaults.keys()) {
    if (!keys.includes(key)) {
      problems.push(`${name}: no TSDoc for ${key}`);
    }
  }
  const leaves = keys.filter(
    (key) => !keys.some((other) => other.startsWith(`${key}.`)),
  );
  const { lead, rest } = splitLead(doc.text);
  return joinBlocks([
    lead,
    code([
      signature(name, entry.node, labels, source),
      ...localTypes(
        [
          ...entry.node.parameters,
          ...(entry.node.type == null ? [] : [entry.node.type]),
        ],
        source,
      ),
    ]),
    bulletList(
      leaves.map((key) => ({
        name: key,
        text: withDefault(params.get(key) ?? "", defaults.get(key)),
      })),
    ),
    returnsLine(doc),
    rest,
  ]);
}

function memberName(
  member: ts.TypeElement | ts.ClassElement,
  source: ts.SourceFile,
) {
  return member.name?.getText(source).replaceAll('"', "") ?? "";
}

function membersOf(
  owner: string,
  members: ReadonlyArray<ts.TypeElement | ts.ClassElement>,
  source: ts.SourceFile,
  defaults = new Map<string, string | null>(),
) {
  const entries: Array<{ name: string; text: string }> = [];
  for (const member of members) {
    if (member.name == null) {
      continue;
    }
    const name = memberName(member, source);
    const doc = docOf(member, source);
    if (doc == null) {
      problems.push(`${owner}.${name} has no TSDoc`);
    } else {
      entries.push({
        name,
        text: withDefault(
          doc.text.replaceAll(/\s*\n\s*/gu, " "),
          defaults.get(name),
        ),
      });
    }
  }
  return bulletList(entries);
}

function typeBody(name: string, entry: Extract<Export, { kind: "type" }>) {
  const source = parse(entry.file);
  const doc = docOf(entry.node, source);
  if (doc == null) {
    problems.push(`${name} has no TSDoc`);
    return "";
  }
  const { lead, rest } = splitLead(doc.text);
  const declaration = flatten(printed(entry.node, source)).replace(
    entry.node.name.text,
    name,
  );
  return joinBlocks([
    lead,
    code([declaration]),
    ts.isTypeLiteralNode(entry.node.type)
      ? membersOf(name, entry.node.type.members, source)
      : "",
    rest,
  ]);
}

function isPublicMember(member: ts.ClassElement) {
  return member.name != null &&
    !ts.isPrivateIdentifier(member.name) &&
    !ts.canHaveModifiers(member)
    ? true
    : member.name != null &&
        !ts.isPrivateIdentifier(member.name) &&
        !ts
          .getModifiers(member as ts.HasModifiers)
          ?.some(({ kind }) => kind === ts.SyntaxKind.PrivateKeyword);
}

function classBody(name: string, entry: Extract<Export, { kind: "class" }>) {
  const source = parse(entry.file);
  const doc = docOf(entry.node, source);
  if (doc == null) {
    problems.push(`${name} has no TSDoc`);
    return "";
  }
  const members = entry.node.members.filter(
    (member) =>
      (ts.isPropertyDeclaration(member) || ts.isGetAccessor(member)) &&
      isPublicMember(member),
  );
  const lines: Array<string> = [];
  for (const member of members) {
    if (ts.isPropertyDeclaration(member)) {
      lines.push(indent(flatten(printed(member, source), WIDTH - 2)));
    } else if (ts.isGetAccessor(member)) {
      const type =
        member.type == null ? "unknown" : printed(member.type, source);
      lines.push(`  get ${memberName(member, source)}(): ${type};`);
    }
  }
  const generics =
    entry.node.typeParameters == null
      ? ""
      : `<${entry.node.typeParameters.map((type) => type.getText(source)).join(", ")}>`;
  const { lead, rest } = splitLead(doc.text);
  return joinBlocks([
    lead,
    code([`class ${name}${generics} {\n${lines.join("\n")}\n}`]),
    membersOf(name, members, source),
    rest,
  ]);
}

function propsOf(source: ts.SourceFile) {
  for (const statement of source.statements) {
    if (ts.isVariableStatement(statement)) {
      for (const declaration of statement.declarationList.declarations) {
        if (
          declaration.initializer != null &&
          ts.isCallExpression(declaration.initializer) &&
          declaration.initializer.expression.getText(source) === "$props" &&
          declaration.type != null &&
          ts.isTypeLiteralNode(declaration.type) &&
          ts.isObjectBindingPattern(declaration.name)
        ) {
          return { type: declaration.type, pattern: declaration.name };
        }
      }
    }
  }
  return null;
}

function componentBody(name: string, file: string, isWholePage = false) {
  const source = parse(file);
  const text = textOf(file);
  const comment = /<!--\s*@component([\s\S]*?)-->/u.exec(text)?.[1];
  if (comment == null) {
    problems.push(`${name} has no @component comment`);
  }
  const doc = readLines(
    (comment ?? "").split("\n").map((line) => line.replace(/^ {2}/u, "")),
  );
  const props = propsOf(source);
  if (props == null) {
    problems.push(`${name} has no typed $props()`);
    return doc.text;
  }
  const defaults = new Map<string, string | null>();
  for (const element of props.pattern.elements) {
    defaults.set(
      (element.propertyName ?? element.name).getText(source),
      literal(element.initializer, source),
    );
  }
  const generics = /<script\b[^>]*\bgenerics="([^"]*)"/u.exec(text)?.[1];
  const { lead, rest } = splitLead(doc.text);
  const members = props.type.members
    .map((member) => indent(flatten(printed(member, source), WIDTH - 2)))
    .join("\n");
  const api = [
    code([
      `type Props${generics == null ? "" : `<${generics}>`} = {\n${members}\n};`,
      ...localTypes([props.type], source),
    ]),
    membersOf(name, props.type.members, source, defaults),
  ];
  return joinBlocks(
    isWholePage ? [doc.text, "## Props", ...api] : [lead, ...api, rest],
  );
}

function pluginBody(entry: Extract<Export, { kind: "plugin" }>) {
  const source = parse(entry.file);
  const doc = docOf(entry.node, source);
  const levels = propertyOf(
    propertyOf(propertyOf(entry.node.expression, "configs"), "recommended"),
    "rules",
  );
  const rules = topConst(source, "rules");
  const lines: Array<string> = [];
  if (rules != null && ts.isObjectLiteralExpression(rules)) {
    for (const property of rules.properties) {
      if (ts.isPropertyAssignment(property)) {
        const key = property.name.getText(source).replaceAll('"', "");
        const rule = ts.isIdentifier(property.initializer)
          ? topConst(source, property.initializer.text)
          : null;
        const description = propertyOf(
          propertyOf(propertyOf(rule, "meta"), "docs"),
          "description",
        );
        const name = `svelte-islands/${key}`;
        const level = propertyOf(levels, name);
        lines.push(
          `- \`${name}\` (${level == null ? "off" : `\`${level.getText(source).replaceAll('"', "")}\``}): ${description == null ? "" : `${description.getText(source).slice(1, -1)}.`}`,
        );
      }
    }
  }
  return joinBlocks([
    doc?.text ?? "",
    "## Rules",
    "The level beside each rule is the one that `configs.recommended` sets.",
    lines.join("\n"),
  ]);
}

function headingBody(entry: Export) {
  switch (entry.kind) {
    case "component": {
      return componentBody(entry.name, entry.file);
    }
    case "function": {
      return functionBody(entry.name, entry);
    }
    case "class": {
      return classBody(entry.name, entry);
    }
    case "type": {
      return typeBody(entry.name, entry);
    }
    default: {
      return "";
    }
  }
}

function importBlock(entry: string, found: Array<Export>) {
  const named = found.flatMap(({ name, kind }) =>
    kind === "type" || name === "default" ? [] : [name],
  );
  const fallback = found.find(({ name }) => name === "default");
  if (fallback?.kind === "plugin") {
    return "";
  }
  if (fallback != null) {
    return code([`import Devtools from "${entry}";`], "js");
  }
  const sorted = named.toSorted((a, b) => a.localeCompare(b));
  const flat = `import { ${sorted.join(", ")} } from "${entry}";`;
  return code(
    [
      flat.length <= WIDTH
        ? flat
        : `import {\n${sorted.map((name) => `  ${name},`).join("\n")}\n} from "${entry}";`,
    ],
    "js",
  );
}

function entryMarkdown(entry: string, file: string) {
  const found = exportsOf(file);
  const blocks = [importBlock(entry, found)];
  const named = found
    .filter(({ name }) => name !== "default")
    .toSorted(
      (a, b) =>
        ORDER.indexOf(a.kind) - ORDER.indexOf(b.kind) ||
        a.name.localeCompare(b.name),
    );
  for (const item of found) {
    if (item.name === "default" && item.kind === "plugin") {
      blocks.push(pluginBody(item));
    } else if (item.name === "default") {
      blocks.push(componentBody("Devtools", item.file, true));
    }
  }
  for (const item of named) {
    blocks.push(`## ${item.name}`, headingBody(item));
  }
  return joinBlocks(blocks);
}

function usageText() {
  const source = parse("budget.ts");
  const usage = topConst(source, "USAGE");
  if (usage == null || !ts.isTemplateExpression(usage)) {
    throw new Error("reference: USAGE in budget.ts is not a template");
  }
  let text = usage.head.text;
  for (const span of usage.templateSpans) {
    text += `${literal(span.expression, source)?.slice(1, -1) ?? ""}${span.literal.text}`;
  }
  return text.trim();
}

function cliMarkdown() {
  return joinBlocks([
    "## svelte-islands check",
    "[Budget check](../50-tooling/10-budget-check.md) explains how to use this in a deploy. This is what the command prints for `--help`:",
    code([usageText()], "text"),
  ]);
}

function sourceFile(target: string) {
  const name = target.replace(/^\.\/dist\//u, "");
  return name.endsWith(".js") ? `${name.slice(0, -3)}.ts` : name;
}

export async function referencePages(
  render: (markdown: string) => Promise<Rendered>,
): Promise<
  Array<
    Rendered & {
      slug: string;
      file: string | null;
      section: string;
      title: string;
      description: string;
      markdown: string;
    }
  >
> {
  const made = [];
  for (const [key, target] of Object.entries(manifest.exports)) {
    if (typeof target === "string") {
      continue;
    }
    const file = sourceFile(target.default);
    const title =
      key === "." ? manifest.name : `${manifest.name}/${key.slice(2)}`;
    const markdown = entryMarkdown(title, file);
    made.push({
      slug: `reference/${key === "." ? manifest.name : key.slice(2)}`,
      file: file === "index.ts" ? null : `src/lib/${file}`,
      section: "Reference",
      title,
      description: `The API of ${title}.`,
      markdown,
      ...(await render(markdown)),
    });
  }
  const markdown = cliMarkdown();
  made.push({
    slug: "reference/cli",
    file: "src/lib/budget.ts",
    section: "Reference",
    title: "CLI",
    description: "The svelte-islands command.",
    markdown,
    ...(await render(markdown)),
  });
  if (problems.length > 0) {
    throw new Error(`reference:\n${problems.join("\n")}`);
  }
  return made;
}
