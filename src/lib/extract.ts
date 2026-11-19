import type { AST } from "svelte/compiler";
import MagicString from "magic-string";
import { createHash } from "node:crypto";
import { parse } from "svelte/compiler";
import { coded } from "./errors.js";

type Node = { type: string; start: number; end: number } & Record<
  string,
  unknown
>;

type Imported = {
  source: string;
  kind: "default" | "namespace" | "named";
  imported: string;
  attributes: string;
};

type Declaration = {
  name: string;
  scope: Scope;
  kind: "template" | "snippet" | "local" | "import" | "store";
  isMutable?: boolean;
  snippet?: { node: AST.SnippetBlock; scope: Scope };
  imported?: Imported;
};

type Reference = {
  name: string;
  start: number;
  end: number;
  role:
    | "expression"
    | "shorthand-property"
    | "shorthand-attribute"
    | "shorthand-directive"
    | "shorthand-style"
    | "component"
    | "directive"
    | "debug";
  owner: Node | null;
  isWrite: boolean;
  declaration: Declaration | null;
};

class Scope {
  readonly names = new Map<string, Declaration>();
  readonly parent: Scope | null;

  constructor(parent: Scope | null) {
    this.parent = parent;
  }

  declare(name: string, extra: Omit<Declaration, "name" | "scope">) {
    this.names.set(name, { name, scope: this, ...extra });
  }

  lookup(name: string): Declaration | null {
    return this.names.get(name) ?? this.parent?.lookup(name) ?? null;
  }
}

const SKIPPED_KEYS = new Set([
  "type",
  "start",
  "end",
  "loc",
  "range",
  "typeAnnotation",
  "returnType",
  "typeParameters",
  "typeArguments",
  "leadingComments",
  "trailingComments",
  "metadata",
  "decorators",
]);

const TYPE_WRAPPERS = new Set([
  "TSAsExpression",
  "TSSatisfiesExpression",
  "TSNonNullExpression",
  "TSTypeAssertion",
  "TSInstantiationExpression",
]);

const RUNES = new Set([
  "$state",
  "$derived",
  "$effect",
  "$props",
  "$bindable",
  "$inspect",
  "$host",
]);

function asNode(value: object): Node {
  return value as Node;
}

function nodesOf(values: ReadonlyArray<object>): Array<Node> {
  return values.map((value) => asNode(value));
}

function isSnippetBlock(node: Node): node is Node & AST.SnippetBlock {
  return node.type === "SnippetBlock";
}

function isComponent(node: Node): node is Node & AST.Component {
  return node.type === "Component";
}

function isElement(
  node: Node,
): node is Node & (AST.RegularElement | AST.SvelteElement) {
  return node.type === "RegularElement" || node.type === "SvelteElement";
}

function isNode(value: unknown): value is Node {
  return (
    typeof value === "object" &&
    value != null &&
    typeof (value as { type?: unknown }).type === "string"
  );
}

function children(node: Node): Array<Node> {
  const found: Array<Node> = [];
  for (const [key, value] of Object.entries(node)) {
    if (SKIPPED_KEYS.has(key)) {
      continue;
    }
    if (Array.isArray(value)) {
      for (const item of value) {
        if (isNode(item)) {
          found.push(item);
        }
      }
    } else if (isNode(value)) {
      found.push(value);
    }
  }
  return found;
}

function namesOf(pattern: Node | null | undefined, into: Array<string> = []) {
  if (pattern == null) {
    return into;
  }
  switch (pattern.type) {
    case "Identifier": {
      into.push(pattern.name as string);
      break;
    }
    case "ObjectPattern": {
      for (const property of pattern.properties as Array<Node>) {
        namesOf(
          property.type === "RestElement"
            ? (property.argument as Node)
            : (property.value as Node),
          into,
        );
      }
      break;
    }
    case "ArrayPattern": {
      for (const element of pattern.elements as Array<Node | null>) {
        namesOf(element, into);
      }
      break;
    }
    case "RestElement": {
      namesOf(pattern.argument as Node, into);
      break;
    }
    case "AssignmentPattern": {
      namesOf(pattern.left as Node, into);
      break;
    }
    case "TSParameterProperty": {
      namesOf(pattern.parameter as Node, into);
      break;
    }
  }
  return into;
}

const BLOCKS = new Set([
  "IfBlock",
  "EachBlock",
  "AwaitBlock",
  "KeyBlock",
  "SnippetBlock",
]);

const ELEMENT_LIKE = new Set([
  "RegularElement",
  "Component",
  "SvelteElement",
  "SvelteComponent",
  "SvelteBoundary",
  "SvelteFragment",
  "SvelteHead",
  "SvelteBody",
  "SvelteWindow",
  "SvelteDocument",
  "TitleElement",
  "SlotElement",
]);

const KEYED = new Set(["Property", "MethodDefinition", "PropertyDefinition"]);

const NAMED_DIRECTIVES = new Set([
  "UseDirective",
  "TransitionDirective",
  "AnimateDirective",
]);

const LEGACY_PROPS = new Set(["$$props", "$$restProps", "$$slots"]);

const FUNCTIONS = new Set([
  "FunctionDeclaration",
  "FunctionExpression",
  "ArrowFunctionExpression",
]);

function isFunction(node: Node) {
  return FUNCTIONS.has(node.type);
}

function hoistVars(node: Node, into: Array<string>) {
  for (const child of children(node)) {
    if (isFunction(child)) {
      continue;
    }
    if (child.type === "VariableDeclaration" && child.kind === "var") {
      for (const declarator of child.declarations as Array<Node>) {
        namesOf(declarator.id as Node, into);
      }
    }
    hoistVars(child, into);
  }
}

function declarePattern(pattern: Node | null | undefined, scope: Scope) {
  for (const name of namesOf(pattern)) {
    scope.declare(name, { kind: "template" });
  }
}

function declareFragment(nodes: ReadonlyArray<Node>, scope: Scope) {
  for (const node of nodes) {
    if (isSnippetBlock(node)) {
      scope.declare(node.expression.name, {
        kind: "snippet",
        snippet: { node, scope },
      });
    } else if (node.type === "ConstTag" || node.type === "DeclarationTag") {
      for (const declarator of (node.declaration as Node)
        .declarations as Array<Node>) {
        declarePattern(declarator.id as Node, scope);
      }
    }
  }
}

function expressionTags(value: unknown) {
  const parts = (Array.isArray(value) ? value : [value]) as Array<Node>;
  return parts.filter((part) => part.type === "ExpressionTag");
}

function nothing() {}

class Walker {
  readonly references: Array<Reference> = [];
  readonly inner = new Set<Scope>();
  readonly problems: Array<string> = [];

  scope(parent: Scope) {
    const made = new Scope(parent);
    this.inner.add(made);
    return made;
  }

  reference(
    name: string,
    node: { start: number; end: number },
    scope: Scope,
    role: Reference["role"] = "expression",
    owner: Node | null = null,
    isWrite = false,
  ) {
    if (LEGACY_PROPS.has(name)) {
      this.problems.push(`it reads ${name}`);
      return;
    }
    let declaration = scope.lookup(name);
    if (declaration == null && name.startsWith("$") && !RUNES.has(name)) {
      const store = scope.lookup(name.slice(1));
      if (store != null && store.kind !== "template") {
        declaration = { name, scope: store.scope, kind: "store" };
      }
    }
    this.references.push({
      name,
      start: node.start,
      end: node.end,
      role,
      owner,
      isWrite,
      declaration,
    });
  }

  identifier(
    node: Node,
    scope: Scope,
    role: Reference["role"],
    owner: Node | null = null,
    isWrite = false,
  ) {
    if (node.type === "Identifier") {
      this.reference(node.name as string, node, scope, role, owner, isWrite);
    } else {
      this.expression(node, scope);
    }
  }

  computedKey(node: Node, scope: Scope) {
    if (node.computed === true) {
      this.expression(node.key as Node, scope);
    }
  }

  pattern(
    pattern: Node | null | undefined,
    scope: Scope,
    leaf: (node: Node) => void,
  ) {
    if (pattern == null) {
      return;
    }
    switch (pattern.type) {
      case "AssignmentPattern": {
        this.pattern(pattern.left as Node, scope, leaf);
        this.expression(pattern.right as Node, scope);
        break;
      }
      case "ObjectPattern": {
        for (const property of pattern.properties as Array<Node>) {
          if (property.type === "RestElement") {
            this.pattern(property.argument as Node, scope, leaf);
          } else {
            this.computedKey(property, scope);
            this.pattern(property.value as Node, scope, leaf);
          }
        }
        break;
      }
      case "ArrayPattern": {
        for (const element of pattern.elements as Array<Node | null>) {
          this.pattern(element, scope, leaf);
        }
        break;
      }
      case "RestElement": {
        this.pattern(pattern.argument as Node, scope, leaf);
        break;
      }
      default: {
        leaf(pattern);
      }
    }
  }

  defaults(pattern: Node | null | undefined, scope: Scope) {
    this.pattern(pattern, scope, nothing);
  }

  target(pattern: Node | null | undefined, scope: Scope) {
    this.pattern(pattern, scope, (node) => {
      this.identifier(node, scope, "expression", null, true);
    });
  }

  fn(node: Node, scope: Scope) {
    const inner = this.scope(scope);
    if (node.type === "FunctionExpression" && isNode(node.id)) {
      inner.declare(node.id.name as string, { kind: "template" });
    }
    for (const param of node.params as Array<Node>) {
      declarePattern(param, inner);
    }
    const vars: Array<string> = [];
    hoistVars(node.body as Node, vars);
    for (const name of vars) {
      inner.declare(name, { kind: "template" });
    }
    for (const param of node.params as Array<Node>) {
      this.defaults(param, inner);
    }
    const body = node.body as Node;
    if (body.type === "BlockStatement") {
      this.statements(body.body as Array<Node>, inner);
    } else {
      this.expression(body, inner);
    }
  }

  statements(body: Array<Node>, scope: Scope) {
    for (const statement of body) {
      if (
        statement.type === "VariableDeclaration" &&
        statement.kind !== "var"
      ) {
        for (const declarator of statement.declarations as Array<Node>) {
          declarePattern(declarator.id as Node, scope);
        }
      } else if (
        (statement.type === "FunctionDeclaration" ||
          statement.type === "ClassDeclaration") &&
        isNode(statement.id)
      ) {
        scope.declare(statement.id.name as string, { kind: "template" });
      }
    }
    for (const statement of body) {
      this.expression(statement, scope);
    }
  }

  classLike(node: Node, scope: Scope) {
    const inner = this.scope(scope);
    if (isNode(node.id)) {
      inner.declare(node.id.name as string, { kind: "template" });
    }
    this.expression(node.superClass as Node, inner);
    this.expression(node.body as Node, inner);
  }

  loop(node: Node, scope: Scope) {
    const inner = this.scope(scope);
    const head = (node.init ?? node.left) as Node | null;
    if (head?.type === "VariableDeclaration") {
      for (const declarator of head.declarations as Array<Node>) {
        declarePattern(declarator.id as Node, inner);
      }
      this.expression(head, inner);
    } else if (node.type === "ForStatement") {
      this.expression(head, inner);
    } else {
      this.target(head, inner);
    }
    this.expression(node.test as Node, inner);
    this.expression(node.update as Node, inner);
    this.expression(node.right as Node, inner);
    this.expression(node.body as Node, inner);
  }

  switchStatement(node: Node, scope: Scope) {
    this.expression(node.discriminant as Node, scope);
    const inner = this.scope(scope);
    const cases = node.cases as Array<Node>;
    this.statements(
      cases.flatMap((each) => each.consequent as Array<Node>),
      inner,
    );
    for (const each of cases) {
      this.expression(each.test as Node | null, inner);
    }
  }

  expression(node: Node | null | undefined, scope: Scope): void {
    if (node == null) {
      return;
    }
    if (TYPE_WRAPPERS.has(node.type)) {
      this.expression(node.expression as Node, scope);
      return;
    }
    if (node.type.startsWith("TS")) {
      return;
    }
    switch (node.type) {
      case "Identifier": {
        this.reference(node.name as string, node, scope);
        return;
      }
      case "MemberExpression": {
        this.expression(node.object as Node, scope);
        if (node.computed === true) {
          this.expression(node.property as Node, scope);
        }
        return;
      }
      case "Property": {
        this.computedKey(node, scope);
        this.identifier(
          node.value as Node,
          scope,
          node.shorthand === true ? "shorthand-property" : "expression",
        );
        return;
      }
      case "MethodDefinition":
      case "PropertyDefinition":
      case "AccessorProperty": {
        this.computedKey(node, scope);
        this.expression(node.value as Node, scope);
        return;
      }
      case "FunctionExpression":
      case "ArrowFunctionExpression":
      case "FunctionDeclaration": {
        this.fn(node, scope);
        return;
      }
      case "ClassDeclaration":
      case "ClassExpression": {
        this.classLike(node, scope);
        return;
      }
      case "BlockStatement":
      case "StaticBlock": {
        this.statements(node.body as Array<Node>, this.scope(scope));
        return;
      }
      case "VariableDeclaration": {
        for (const declarator of node.declarations as Array<Node>) {
          this.defaults(declarator.id as Node, scope);
          this.expression(declarator.init as Node, scope);
        }
        return;
      }
      case "ForStatement":
      case "ForInStatement":
      case "ForOfStatement": {
        this.loop(node, scope);
        return;
      }
      case "CatchClause": {
        const inner = this.scope(scope);
        declarePattern(node.param as Node, inner);
        this.defaults(node.param as Node, inner);
        this.expression(node.body as Node, inner);
        return;
      }
      case "SwitchStatement": {
        this.switchStatement(node, scope);
        return;
      }
      case "LabeledStatement": {
        this.expression(node.body as Node, scope);
        return;
      }
      case "BreakStatement":
      case "ContinueStatement":
      case "MetaProperty":
      case "Literal":
      case "ThisExpression":
      case "Super":
      case "EmptyStatement":
      case "DebuggerStatement": {
        return;
      }
      case "AssignmentExpression": {
        this.target(node.left as Node, scope);
        this.expression(node.right as Node, scope);
        return;
      }
      case "UpdateExpression": {
        this.identifier(node.argument as Node, scope, "expression", null, true);
        return;
      }
      default: {
        for (const child of children(node)) {
          this.expression(child, scope);
        }
      }
    }
  }

  attributeValue(attribute: Node, scope: Scope, code: string) {
    const { value } = attribute;
    if (value === true) {
      return;
    }
    const role =
      !Array.isArray(value) && code[attribute.start] === "{"
        ? "shorthand-attribute"
        : "expression";
    for (const part of expressionTags(value)) {
      this.identifier(part.expression as Node, scope, role, attribute);
    }
  }

  styleDirective(attribute: Node, scope: Scope) {
    if (attribute.value === true) {
      this.reference(
        attribute.name as string,
        attribute,
        scope,
        "shorthand-style",
        attribute,
      );
      return;
    }
    for (const part of expressionTags(attribute.value)) {
      this.expression(part.expression as Node, scope);
    }
  }

  namedDirective(attribute: Node, scope: Scope, code: string) {
    const [base = ""] = (attribute.name as string).split(".", 1);
    const start = code.indexOf(":", attribute.start) + 1;
    this.reference(
      base,
      { start, end: start + base.length },
      scope,
      "directive",
      attribute,
    );
    this.expression(attribute.expression as Node | null, scope);
  }

  attribute(attribute: Node, scope: Scope, code: string) {
    const role =
      code[attribute.end - 1] === "}" ? "expression" : "shorthand-directive";
    switch (attribute.type) {
      case "Attribute": {
        this.attributeValue(attribute, scope, code);
        return;
      }
      case "SpreadAttribute":
      case "AttachTag":
      case "OnDirective": {
        this.expression(attribute.expression as Node | null, scope);
        return;
      }
      case "BindDirective": {
        this.identifier(
          attribute.expression as Node,
          scope,
          role,
          attribute,
          true,
        );
        return;
      }
      case "ClassDirective": {
        this.identifier(attribute.expression as Node, scope, role, attribute);
        return;
      }
      case "StyleDirective": {
        this.styleDirective(attribute, scope);
        return;
      }
      case "UseDirective":
      case "TransitionDirective":
      case "AnimateDirective": {
        this.namedDirective(attribute, scope, code);
        return;
      }
      case "LetDirective": {
        this.problems.push("it uses let:");
      }
    }
  }

  fragment(fragment: AST.Fragment, parent: Scope, code: string) {
    const scope = this.scope(parent);
    const nodes = nodesOf(fragment.nodes);
    declareFragment(nodes, scope);
    for (const node of nodes) {
      this.node(node, scope, code);
    }
  }

  snippet(node: AST.SnippetBlock, parent: Scope, code: string) {
    const inner = this.scope(parent);
    for (const parameter of node.parameters) {
      declarePattern(asNode(parameter), inner);
    }
    for (const parameter of node.parameters) {
      this.defaults(asNode(parameter), inner);
    }
    this.fragment(node.body, inner, code);
  }

  branch(
    fragment: AST.Fragment | null,
    pattern: Node | null,
    scope: Scope,
    code: string,
  ) {
    if (fragment == null) {
      return;
    }
    const inner = this.scope(scope);
    declarePattern(pattern, inner);
    this.defaults(pattern, inner);
    this.fragment(fragment, inner, code);
  }

  each(node: Node, scope: Scope, code: string) {
    this.expression(node.expression as Node, scope);
    const inner = this.scope(scope);
    declarePattern(node.context as Node | null, inner);
    if (typeof node.index === "string") {
      inner.declare(node.index, { kind: "template" });
    }
    this.defaults(node.context as Node | null, inner);
    this.expression(node.key as Node | undefined, inner);
    this.fragment(node.body as AST.Fragment, inner, code);
    if (node.fallback != null) {
      this.fragment(node.fallback as AST.Fragment, scope, code);
    }
  }

  awaitBlock(node: Node, scope: Scope, code: string) {
    this.expression(node.expression as Node, scope);
    if (node.pending != null) {
      this.fragment(node.pending as AST.Fragment, scope, code);
    }
    this.branch(
      node.then as AST.Fragment | null,
      node.value as Node | null,
      scope,
      code,
    );
    this.branch(
      node.catch as AST.Fragment | null,
      node.error as Node | null,
      scope,
      code,
    );
  }

  node(node: Node, scope: Scope, code: string) {
    switch (node.type) {
      case "Text":
      case "Comment": {
        return;
      }
      case "ExpressionTag":
      case "HtmlTag":
      case "RenderTag":
      case "AttachTag": {
        this.expression(node.expression as Node, scope);
        return;
      }
      case "KeyBlock": {
        this.expression(node.expression as Node, scope);
        this.fragment(node.fragment as AST.Fragment, scope, code);
        return;
      }
      case "ConstTag":
      case "DeclarationTag": {
        this.expression(node.declaration as Node, scope);
        return;
      }
      case "DebugTag": {
        for (const identifier of node.identifiers as Array<Node>) {
          this.reference(identifier.name as string, identifier, scope, "debug");
        }
        return;
      }
      case "IfBlock": {
        this.expression(node.test as Node, scope);
        this.fragment(node.consequent as AST.Fragment, scope, code);
        if (node.alternate != null) {
          this.fragment(node.alternate as AST.Fragment, scope, code);
        }
        return;
      }
      case "EachBlock": {
        this.each(node, scope, code);
        return;
      }
      case "AwaitBlock": {
        this.awaitBlock(node, scope, code);
        return;
      }
      case "SnippetBlock": {
        if (isSnippetBlock(node)) {
          this.snippet(node, scope, code);
        }
        return;
      }
      case "SvelteSelf": {
        this.problems.push("it uses <svelte:self>");
        return;
      }
      case "SlotElement": {
        this.problems.push("it uses <slot>");
        return;
      }
      default: {
        this.element(node, scope, code);
      }
    }
  }

  element(node: Node, scope: Scope, code: string) {
    switch (node.type) {
      case "Component": {
        const name = node.name as string;
        const [base = name] = name.split(".", 1);
        this.reference(
          base,
          { start: node.start + 1, end: node.start + 1 + base.length },
          scope,
          "component",
          node,
        );
        break;
      }
      case "SvelteElement": {
        this.expression(node.tag as Node, scope);
        break;
      }
      case "SvelteComponent": {
        this.expression(node.expression as Node, scope);
        break;
      }
    }
    const attributes = (node.attributes ?? []) as Array<Node>;
    for (const attribute of attributes) {
      this.attribute(attribute, scope, code);
    }
    if (node.fragment != null) {
      this.fragment(node.fragment as AST.Fragment, scope, code);
    }
  }
}

function nameOf(node: Node) {
  return (node.name ?? node.value) as string;
}

function importAttributes(declaration: Node) {
  const attributes = (declaration.attributes ?? []) as Array<Node>;
  if (attributes.length === 0) {
    return "";
  }
  const pairs = attributes.map(
    (attribute) =>
      `${JSON.stringify(nameOf(attribute.key as Node))}: ${JSON.stringify((attribute.value as Node).value)}`,
  );
  return ` with { ${pairs.join(", ")} }`;
}

function specifierKind(specifier: Node): Imported["kind"] {
  if (specifier.type === "ImportDefaultSpecifier") {
    return "default";
  }
  return specifier.type === "ImportNamespaceSpecifier" ? "namespace" : "named";
}

function declareImports(declaration: Node, scope: Scope, islands: Set<string>) {
  if (declaration.importKind === "type") {
    return;
  }
  const source = (declaration.source as Node).value as string;
  const attributes = importAttributes(declaration);
  for (const specifier of declaration.specifiers as Array<Node>) {
    if (specifier.importKind === "type") {
      continue;
    }
    const local = (specifier.local as Node).name as string;
    const kind = specifierKind(specifier);
    const imported =
      kind === "named" ? nameOf(specifier.imported as Node) : kind;
    if (source === "svelte-islands" && imported === "Island") {
      islands.add(local);
    }
    scope.declare(local, {
      kind: "import",
      imported: { source, kind, imported, attributes },
    });
  }
}

function isLive(node: Node | null | undefined): boolean {
  if (node == null) {
    return false;
  }
  if (
    isFunction(node) ||
    (node.type === "Property" && (node.kind !== "init" || node.method === true))
  ) {
    return true;
  }
  if (node.type === "CallExpression") {
    const callee = node.callee as Node;
    const name =
      callee.type === "MemberExpression"
        ? (callee.object as Node).name
        : callee.name;
    if (typeof name === "string" && RUNES.has(name)) {
      return true;
    }
  }
  return children(node).some((child) => isLive(child));
}

function declareStatement(statement: Node, scope: Scope, islands: Set<string>) {
  const declared =
    statement.type === "ExportNamedDeclaration" && isNode(statement.declaration)
      ? statement.declaration
      : statement;
  switch (declared.type) {
    case "ImportDeclaration": {
      declareImports(declared, scope, islands);
      break;
    }
    case "VariableDeclaration": {
      for (const declarator of declared.declarations as Array<Node>) {
        const isMutable =
          declared.kind !== "const" || isLive(declarator.init as Node | null);
        for (const name of namesOf(declarator.id as Node)) {
          scope.declare(name, { kind: "local", isMutable });
        }
      }
      break;
    }
    case "FunctionDeclaration":
    case "ClassDeclaration":
    case "TSEnumDeclaration": {
      if (isNode(declared.id)) {
        scope.declare(declared.id.name as string, {
          kind: "local",
          isMutable: true,
        });
      }
      break;
    }
  }
}

function scriptScope(scripts: Array<AST.Script | null>) {
  const scope = new Scope(null);
  const islands = new Set<string>();
  for (const script of scripts) {
    const statements = nodesOf(script?.content.body ?? []);
    for (const statement of statements) {
      declareStatement(statement, scope, islands);
    }
  }
  return { scope, islands };
}

type Compound = ReadonlyArray<AST.CSS.SimpleSelector>;

type Traits = {
  tag: string | null;
  classes: Set<string> | null;
  ids: Set<string> | null;
  attributes: Set<string> | null;
};

function isGlobal(selector: AST.CSS.SimpleSelector) {
  return selector.type === "PseudoClassSelector" && selector.name === "global";
}

function isBareGlobal(selector: AST.CSS.SimpleSelector) {
  return (
    isGlobal(selector) &&
    selector.type === "PseudoClassSelector" &&
    selector.args == null
  );
}

function collectRelatives(
  relatives: AST.CSS.ComplexSelector["children"],
  found: Array<Compound>,
) {
  for (const relative of relatives) {
    if (relative.selectors.some((selector) => isBareGlobal(selector))) {
      return;
    }
    const isOwn = relative.selectors.some(
      (selector) => !isGlobal(selector) && selector.type !== "NestingSelector",
    );
    if (isOwn) {
      found.push(relative.selectors);
    }
    for (const selector of relative.selectors) {
      if (
        selector.type === "PseudoClassSelector" &&
        selector.args != null &&
        !isGlobal(selector)
      ) {
        collectCompounds(selector.args, found);
      }
    }
  }
}

function collectCompounds(list: AST.CSS.SelectorList, found: Array<Compound>) {
  for (const complex of list.children) {
    collectRelatives(complex.children, found);
  }
}

function isGlobalBlock(rule: AST.CSS.Rule) {
  return rule.prelude.children.every((complex) =>
    complex.children.some((relative) =>
      relative.selectors.some((selector) => isBareGlobal(selector)),
    ),
  );
}

function scopedCompounds(css: AST.CSS.StyleSheet | null) {
  const found: Array<Compound> = [];
  const visit = (nodes: ReadonlyArray<AST.CSS.Node>) => {
    for (const node of nodes) {
      if (node.type === "Atrule") {
        if (!node.name.endsWith("keyframes") && node.block != null) {
          visit(node.block.children);
        }
      } else if (node.type === "Rule") {
        collectCompounds(node.prelude, found);
        if (!isGlobalBlock(node)) {
          visit(node.block.children);
        }
      }
    }
  };
  visit(css?.children ?? []);
  return found;
}

function wordsOf(value: AST.Attribute["value"]) {
  if (value === true) {
    return [];
  }
  if (!Array.isArray(value) || value.some((piece) => piece.type !== "Text")) {
    return null;
  }
  return value
    .map((piece) => (piece.type === "Text" ? piece.data : ""))
    .join("")
    .split(/\s+/u)
    .filter((word) => word !== "");
}

function addWords(
  traits: Traits,
  key: "classes" | "ids",
  value: AST.Attribute["value"],
) {
  const words = wordsOf(value);
  if (words == null) {
    traits[key] = null;
    return;
  }
  for (const word of words) {
    traits[key]?.add(word);
  }
}

function noteAttribute(
  traits: Traits,
  attribute: AST.RegularElement["attributes"][number],
) {
  switch (attribute.type) {
    case "ClassDirective": {
      traits.classes?.add(attribute.name);
      traits.attributes?.add("class");
      break;
    }
    case "StyleDirective": {
      traits.attributes?.add("style");
      break;
    }
    case "BindDirective": {
      traits.attributes?.add(attribute.name.toLowerCase());
      break;
    }
    case "Attribute": {
      const name = attribute.name.toLowerCase();
      traits.attributes?.add(name);
      if (name === "class") {
        addWords(traits, "classes", attribute.value);
      } else if (name === "id") {
        addWords(traits, "ids", attribute.value);
      }
      break;
    }
    default: {
      break;
    }
  }
}

function traitsOf(element: AST.RegularElement | AST.SvelteElement): Traits {
  const tag =
    element.type === "RegularElement" ? element.name.toLowerCase() : null;
  if (
    element.attributes.some((attribute) => attribute.type === "SpreadAttribute")
  ) {
    return { tag, classes: null, ids: null, attributes: null };
  }
  const traits: Traits = {
    tag,
    classes: new Set(),
    ids: new Set(),
    attributes: new Set(),
  };
  for (const attribute of element.attributes) {
    noteAttribute(traits, attribute);
  }
  return traits;
}

function isMatchable(traits: Traits, compound: Compound) {
  return compound.every((selector) => {
    switch (selector.type) {
      case "TypeSelector": {
        return (
          selector.name === "*" ||
          traits.tag == null ||
          selector.name.toLowerCase() === traits.tag
        );
      }
      case "ClassSelector": {
        return traits.classes == null || traits.classes.has(selector.name);
      }
      case "IdSelector": {
        return traits.ids == null || traits.ids.has(selector.name);
      }
      case "AttributeSelector": {
        return (
          traits.attributes == null ||
          traits.attributes.has(selector.name.toLowerCase())
        );
      }
      case "PseudoClassSelector": {
        return selector.name !== "root" && selector.name !== "host";
      }
      default: {
        return true;
      }
    }
  });
}

function styledIn(
  values: Iterable<unknown>,
  compounds: ReadonlyArray<Compound>,
): string | null {
  for (const value of values) {
    const found = styledElement(value, compounds);
    if (found != null) {
      return found;
    }
  }
  return null;
}

function styledElement(
  node: unknown,
  compounds: ReadonlyArray<Compound>,
): string | null {
  if (compounds.length === 0) {
    return null;
  }
  if (Array.isArray(node)) {
    return styledIn(node, compounds);
  }
  if (!isNode(node)) {
    return null;
  }
  if (isElement(node)) {
    const traits = traitsOf(node);
    if (compounds.some((compound) => isMatchable(traits, compound))) {
      return node.type === "RegularElement"
        ? `<${node.name}>`
        : "<svelte:element>";
    }
  }
  return styledIn(
    Object.entries(node)
      .filter(
        ([key, value]) =>
          key !== "metadata" && typeof value === "object" && value != null,
      )
      .map(([, value]) => value),
    compounds,
  );
}

function fresh(base: string, code: string) {
  let name = base;
  while (
    new RegExp(
      String.raw`\b${name.replaceAll("$", String.raw`\$`)}\b`,
      "u",
    ).test(code)
  ) {
    name += "_";
  }
  return name;
}

function importLine(
  name: string,
  { source, kind, imported, attributes }: Imported,
) {
  const from = JSON.stringify(source);
  if (kind === "default") {
    return `import ${name} from ${from}${attributes};`;
  }
  if (kind === "namespace") {
    return `import * as ${name} from ${from}${attributes};`;
  }
  const specifier =
    imported === name
      ? name
      : `${/^[\p{ID_Start}$_][\p{ID_Continue}$\u{200C}\u{200D}]*$/u.test(imported) ? imported : JSON.stringify(imported)} as ${name}`;
  return `import { ${specifier} } from ${from}${attributes};`;
}

type Analysis = {
  captures: Map<string, Declaration & { isWritten: boolean }>;
  imports: Map<string, Imported>;
  globals: Set<string>;
  copies: Array<AST.SnippetBlock>;
  references: Array<Reference>;
  problems: Array<string>;
};

function record(
  reference: Reference,
  inner: ReadonlySet<Scope>,
  at: Scope,
  result: Analysis,
): NonNullable<Declaration["snippet"]> | null {
  const { declaration, name } = reference;
  if (declaration == null) {
    result.globals.add(name);
    return null;
  }
  if (inner.has(declaration.scope)) {
    return null;
  }
  if (declaration.kind !== "store" && at.lookup(name) !== declaration) {
    result.problems.push(`"${name}" means something else where the island is`);
    return null;
  }
  if (declaration.kind === "snippet" && declaration.snippet != null) {
    return declaration.snippet;
  }
  if (declaration.kind === "import" && declaration.imported != null) {
    result.imports.set(name, declaration.imported);
    return null;
  }
  if (reference.role === "debug") {
    result.problems.push(`it uses {@debug ${name}}`);
    return null;
  }
  const known = result.captures.get(name);
  if (known != null && known.scope !== declaration.scope) {
    result.problems.push(`"${name}" means two different things`);
    return null;
  }
  result.captures.set(name, {
    ...declaration,
    isWritten: (known?.isWritten ?? false) || reference.isWrite,
  });
  result.references.push(reference);
  return null;
}

function analyze(
  snippet: AST.SnippetBlock,
  declared: Scope,
  at: Scope,
  code: string,
  compounds: ReadonlyArray<Compound>,
): Analysis {
  const result: Analysis = {
    captures: new Map(),
    imports: new Map(),
    globals: new Set(),
    copies: [],
    references: [],
    problems: [],
  };
  const seen = new Set<AST.SnippetBlock>();
  const visit = (node: AST.SnippetBlock, scope: Scope, isCopy: boolean) => {
    if (seen.has(node)) {
      return;
    }
    seen.add(node);
    if (isCopy) {
      result.copies.push(node);
    }
    const styled = styledElement(node.body, compounds);
    if (styled != null) {
      result.problems.push(
        `its ${styled} matches a selector in the page's scoped styles; move the markup into a component, or make the selector :global`,
      );
    }
    const walker = new Walker();
    walker.snippet(node, scope, code);
    result.problems.push(...walker.problems);
    for (const reference of walker.references) {
      const next = record(reference, walker.inner, at, result);
      if (next != null) {
        visit(next.node, next.scope, true);
      }
    }
  };
  visit(snippet, declared, false);
  return result;
}

const CHANGING_GLOBALS = new Set([
  "Date",
  "Math",
  "crypto",
  "performance",
  "window",
  "document",
  "navigator",
  "localStorage",
  "sessionStorage",
  "location",
  ...RUNES,
]);

const LIVE_NODES: Record<string, string> = {
  OnDirective: "an on: directive",
  BindDirective: "a binding",
  UseDirective: "an action",
  AttachTag: "an attachment",
  TransitionDirective: "a transition",
  AnimateDirective: "an animation",
  LetDirective: "let:",
  AwaitBlock: "{#await}",
  DebugTag: "{@debug}",
  SvelteComponent: "<svelte:component>",
  SvelteSelf: "<svelte:self>",
  SlotElement: "<slot>",
  SvelteBoundary: "<svelte:boundary>",
  SvelteHead: "<svelte:head>",
  TitleElement: "<title>",
  SvelteWindow: "<svelte:window>",
  SvelteDocument: "<svelte:document>",
  SvelteBody: "<svelte:body>",
  SvelteFragment: "<svelte:fragment>",
};

const LIVE_SOURCE =
  /^(?:\$app\/|svelte(?:-islands)?(?:\/|$))|\.svelte(?:\.[jt]s)?$/u;

function liveMarkup(node: Node): string | null {
  const known = LIVE_NODES[node.type];
  if (known != null) {
    return `it uses ${known}`;
  }
  if (isComponent(node)) {
    return `it renders <${node.name}>`;
  }
  if (node.type === "SvelteElement" && (node.tag as Node).type !== "Literal") {
    return "it uses <svelte:element> with a this that can change";
  }
  if (node.type === "Attribute" && /^on/iu.test(node.name as string)) {
    return `it has an ${node.name as string} handler`;
  }
  for (const child of children(node)) {
    const found = liveMarkup(child);
    if (found != null) {
      return found;
    }
  }
  return null;
}

function whyLive(snippet: AST.SnippetBlock, analysis: Analysis) {
  for (const capture of analysis.captures.values()) {
    if (capture.kind !== "local" || capture.isMutable !== false) {
      return `it reads ${capture.name}, which can change`;
    }
  }
  for (const [local, imported] of analysis.imports) {
    if (LIVE_SOURCE.test(imported.source)) {
      return `it uses ${local} from ${imported.source}`;
    }
  }
  for (const name of analysis.globals) {
    if (CHANGING_GLOBALS.has(name)) {
      return `it reads ${name}`;
    }
  }
  for (const body of [snippet, ...analysis.copies]) {
    const found = liveMarkup(asNode(body.body));
    if (found != null) {
      return found;
    }
  }
  return null;
}

function isInferable(island: AST.Component) {
  return island.attributes.every((attribute) => {
    if (attribute.type !== "Attribute") {
      return attribute.type !== "SpreadAttribute";
    }
    if (attribute.name === "hydrate") {
      return false;
    }
    return (
      attribute.name !== "render" ||
      (Array.isArray(attribute.value) &&
        attribute.value.length === 1 &&
        attribute.value[0]?.type === "Text" &&
        attribute.value[0].data === "server")
    );
  });
}

function shorthandText(
  role: "shorthand-attribute" | "shorthand-directive" | "shorthand-style",
  name: string,
  member: string,
  original: string,
) {
  switch (role) {
    case "shorthand-attribute": {
      return `${name}={${member}}`;
    }
    case "shorthand-directive": {
      return `${original}={${member}}`;
    }
    case "shorthand-style": {
      return `style:${name}={${member}}`;
    }
  }
}

function renameClosingTag(
  text: MagicString,
  owner: Node,
  name: string,
  member: string,
  code: string,
) {
  const closing = `</${owner.name as string}>`;
  const at = owner.end - closing.length;
  if (code.slice(at, owner.end) === closing) {
    text.overwrite(at + 2, at + 2 + name.length, member);
  }
}

function rewrite(
  text: MagicString,
  reference: Reference,
  scope: string,
  code: string,
) {
  const member = `${scope}.${reference.name}`;
  const { owner, role } = reference;
  switch (role) {
    case "debug": {
      return;
    }
    case "shorthand-property": {
      text.overwrite(
        reference.start,
        reference.end,
        `${reference.name}: ${member}`,
      );
      return;
    }
    case "shorthand-attribute":
    case "shorthand-directive":
    case "shorthand-style": {
      if (owner != null) {
        text.overwrite(
          owner.start,
          owner.end,
          shorthandText(
            role,
            reference.name,
            member,
            code.slice(owner.start, owner.end),
          ),
        );
      }
      return;
    }
    default: {
      text.overwrite(reference.start, reference.end, member);
      if (role === "component" && owner != null) {
        renameClosingTag(text, owner, reference.name, member, code);
      }
    }
  }
}

function scopeObject(
  captures: Analysis["captures"],
  value: string,
  instance: string | null,
) {
  const members: Array<string> = [];
  for (const [name, capture] of captures) {
    members.push(`get ${name}() { return ${name}; }`);
    if (instance == null && capture.isWritten) {
      members.push(`set ${name}(${value}) { ${name} = ${value}; }`);
    }
  }
  if (instance != null) {
    const own = [...captures.values()]
      .filter((capture) => capture.kind === "template")
      .map((capture) => capture.name);
    members.push(
      `[Symbol.for("svelte-islands:scope")]: { instance: ${instance}, own: ${JSON.stringify(own)} }`,
    );
  }
  return `{ ${members.join(", ")} }`;
}

function headerEnd(snippet: AST.SnippetBlock, code: string) {
  const parameter = snippet.parameters.at(-1);
  const last = parameter == null ? undefined : asNode(parameter);
  const from = last?.end ?? code.indexOf("(", asNode(snippet.expression).end);
  return code.indexOf("}", code.indexOf(")", from)) + 1;
}

function digest(text: string, length: number) {
  return createHash("sha256").update(text).digest("base64url").slice(0, length);
}

function locateSnippet(island: AST.Component, at: Scope) {
  const inline = island.fragment.nodes.find(
    (node): node is AST.SnippetBlock =>
      node.type === "SnippetBlock" && node.expression.name === "children",
  );
  if (inline != null) {
    const holder = new Scope(at);
    for (const node of island.fragment.nodes) {
      if (node.type === "SnippetBlock") {
        holder.declare(node.expression.name, {
          kind: "snippet",
          snippet: { node, scope: holder },
        });
      }
    }
    return { snippet: inline, declared: holder, owner: inline, isInline: true };
  }
  const attribute = island.attributes.find(
    (item): item is AST.Attribute =>
      item.type === "Attribute" && item.name === "children",
  );
  if (attribute == null) {
    return null;
  }
  const { value } = attribute;
  if (
    value === true ||
    Array.isArray(value) ||
    value.expression.type !== "Identifier"
  ) {
    return null;
  }
  const declaration = at.lookup(value.expression.name);
  if (declaration?.kind !== "snippet" || declaration.snippet == null) {
    return null;
  }
  return {
    snippet: declaration.snippet.node,
    declared: declaration.snippet.scope,
    owner: attribute,
    isInline: false,
  };
}

function islandSource(
  snippet: AST.SnippetBlock,
  analysis: Analysis,
  text: MagicString,
  code: string,
  names: { scope: string; value: string },
  isTypeScript: boolean,
) {
  const end = headerEnd(snippet, code);
  const close = code.lastIndexOf("{/snippet", snippet.end - 1);
  const parameters = nodesOf(snippet.parameters);
  const first = parameters[0];
  const last = parameters.at(-1);
  const params =
    first != null && last != null
      ? `${text.slice(first.start, last.end)}, ${names.scope}`
      : `_${names.value}, ${names.scope}`;
  const copies = analysis.copies
    .map((copy) => text.slice(copy.start, copy.end))
    .join("");
  const imports = [...analysis.imports]
    .map(([local, imported]) => importLine(local, imported))
    .join("\n  ");
  return `<script module${isTypeScript ? ' lang="ts"' : ""}>
  ${imports}
  export { body };
  export const url = import.meta.url;
</script>

{#snippet body(${params})}${copies}${text.slice(end, close)}{/snippet}
`;
}

function isWalkable(node: Node) {
  return (
    node.type === "Fragment" ||
    ELEMENT_LIKE.has(node.type) ||
    BLOCKS.has(node.type)
  );
}

function templateScope(
  parent: Scope,
  patterns: ReadonlyArray<Node | null | undefined>,
) {
  const inner = new Scope(parent);
  for (const pattern of patterns) {
    declarePattern(pattern, inner);
  }
  return inner;
}

function descend(node: Node, scope: Scope): Array<[Node, Scope]> {
  switch (node.type) {
    case "Fragment": {
      const inner = new Scope(scope);
      const nodes = node.nodes as Array<Node>;
      declareFragment(nodes, inner);
      return nodes.map((child) => [child, inner]);
    }
    case "EachBlock": {
      const inner = templateScope(scope, [node.context as Node | null]);
      if (typeof node.index === "string") {
        inner.declare(node.index, { kind: "template" });
      }
      const next: Array<[Node, Scope]> = [[node.body as Node, inner]];
      if (node.fallback != null) {
        next.push([node.fallback as Node, scope]);
      }
      return next;
    }
    case "AwaitBlock": {
      const branches = [
        [node.pending, null],
        [node.then, node.value],
        [node.catch, node.error],
      ] as Array<[Node | null, Node | null]>;
      return branches
        .filter((branch): branch is [Node, Node | null] => branch[0] != null)
        .map(([fragment, pattern]) => [
          fragment,
          templateScope(scope, [pattern]),
        ]);
    }
    case "SnippetBlock": {
      return [
        [
          node.body as Node,
          templateScope(scope, node.parameters as Array<Node>),
        ],
      ];
    }
    default: {
      return children(node)
        .filter((child) => isWalkable(child))
        .map((child) => [child, scope]);
    }
  }
}

export type Extracted = {
  code: string;
  map: ReturnType<MagicString["generateMap"]>;
  modules: Array<{ id: string; file: string; source: string }>;
  warnings: Array<string>;
};

/**
 * Moves each island's snippet into its own module for the browser build, or
 * marks each island for the server build so shell pages can boot it.
 *
 * @param code The component's source.
 * @param filename The component's path, used for the island modules' paths.
 * @param name The component's path relative to the project, used for stable ids.
 * @param target Which build this is for.
 * @returns The rewritten component and its island modules, or `null` if it has no islands.
 */
export function extract(
  code: string,
  filename: string,
  name: string,
  target: "client" | "server",
  isDev = false,
): Extracted | null {
  if (!code.includes("svelte-islands")) {
    return null;
  }
  const root = parse(code, { modern: true, filename });
  const { scope: top, islands } = scriptScope([root.module, root.instance]);
  if (islands.size === 0) {
    return null;
  }
  const isServer = target === "server";
  const compounds = scopedCompounds(root.css);
  const isTypeScript = [root.instance, root.module].some((script) =>
    script?.attributes.some(
      (attribute) =>
        attribute.name === "lang" &&
        Array.isArray(attribute.value) &&
        attribute.value.some(
          (part) => part.type === "Text" && part.data === "ts",
        ),
    ),
  );
  const page = new MagicString(code);
  const moduleText = new MagicString(code);
  const scopeName = fresh("scope", code);
  const valueName = fresh("value", code);
  const instanceName =
    isServer && root.instance != null ? fresh("instance", code) : null;
  let isInstanced = false;
  const modules: Extracted["modules"] = [];
  const warnings: Array<string> = [];
  const rewritten = new Set<number>();
  const removed: Array<[number, number]> = [];
  const moved = new Map<string, Imported>();
  const prunable = new Set<AST.SnippetBlock>();

  const visitIsland = (island: AST.Component, at: Scope) => {
    const located = locateSnippet(island, at);
    const line = code.slice(0, island.start).split("\n").length;
    if (located == null) {
      warnings.push(
        coded(
          "islands_island_kept",
          `${name}:${line}: the island stays in the page, because its children aren't a snippet the plugin can find`,
        ),
      );
      return false;
    }
    const analysis = analyze(
      located.snippet,
      located.declared,
      at,
      code,
      compounds,
    );
    if (analysis.problems.length > 0) {
      warnings.push(
        coded(
          "islands_island_kept",
          `${name}:${line}: the island stays in the page, because ${[...new Set(analysis.problems)].join(", ")}`,
        ),
      );
      return false;
    }
    const id = digest(`${name}:${modules.length}`, 12);
    const scope =
      analysis.captures.size === 0
        ? ""
        : ` scope={${scopeObject(analysis.captures, valueName, instanceName)}}`;
    isInstanced ||= instanceName != null && analysis.captures.size > 0;
    const nameEnd = island.start + 1 + island.name.length;
    if (isInferable(island)) {
      const why = whyLive(located.snippet, analysis);
      if (why == null) {
        page.appendLeft(nameEnd, ` hydrate="never"`);
      }
      if (isDev) {
        page.appendLeft(nameEnd, ` why={${JSON.stringify(why ?? "inferred")}}`);
      }
    }
    if (isServer) {
      page.appendLeft(nameEnd, ` module="${id}"${scope}`);
      modules.push({ id, file: "", source: "" });
      return true;
    }
    for (const reference of analysis.references) {
      if (rewritten.has(reference.start)) {
        continue;
      }
      rewritten.add(reference.start);
      rewrite(moduleText, reference, scopeName, code);
    }
    const source = islandSource(
      located.snippet,
      analysis,
      moduleText,
      code,
      { scope: scopeName, value: valueName },
      isTypeScript,
    );
    const file = `${filename}.__island-${digest(source, 10)}.svelte`;
    modules.push({ id, file, source });
    for (const copy of analysis.copies) {
      prunable.add(copy);
    }
    for (const [local, imported] of analysis.imports) {
      moved.set(local, imported);
    }
    page.remove(located.owner.start, located.owner.end);
    removed.push([located.owner.start, located.owner.end]);
    if (!located.isInline) {
      prunable.add(located.snippet);
    }
    page.appendLeft(
      nameEnd,
      ` code={() => import(${JSON.stringify(file)})} module="${id}"${scope}`,
    );
    return true;
  };

  const walk = (node: Node, scope: Scope): void => {
    if (
      isComponent(node) &&
      islands.has(node.name) &&
      visitIsland(node, scope)
    ) {
      return;
    }
    for (const [child, inner] of descend(node, scope)) {
      walk(child, inner);
    }
  };

  walk(asNode(root.fragment), top);
  if (modules.length === 0) {
    return warnings.length > 0
      ? { code, map: page.generateMap({ hires: true }), modules, warnings }
      : null;
  }
  if (!isServer) {
    pruneSnippets(prunable, root, page, removed);
    pruneImports(moved, root, code, page, removed);
  }
  if (isInstanced && root.instance != null) {
    page.appendLeft(
      asNode(root.instance.content).end,
      `\nconst ${instanceName} = {};\n`,
    );
  }
  return {
    code: page.toString(),
    map: page.generateMap({ hires: true, source: filename }),
    modules,
    warnings,
  };
}

function isRemoved(start: number, removed: Array<[number, number]>) {
  return removed.some(([from, to]) => start >= from && start < to);
}

const IMPORT_SPECIFIERS = new Set([
  "ImportSpecifier",
  "ImportDefaultSpecifier",
  "ImportNamespaceSpecifier",
]);

function isPropertyName(parent: Node | null, key: string) {
  if (parent == null) {
    return false;
  }
  if (IMPORT_SPECIFIERS.has(parent.type)) {
    return true;
  }
  if (parent.computed === true) {
    return false;
  }
  return (
    (parent.type === "MemberExpression" && key === "property") ||
    (KEYED.has(parent.type) && key === "key" && parent.shorthand !== true)
  );
}

function namesIn(node: Node, parent: Node | null, key: string) {
  if (node.type === "Identifier") {
    if (isPropertyName(parent, key)) {
      return [];
    }
    const name = node.name as string;
    return name.startsWith("$") ? [name, name.slice(1)] : [name];
  }
  if (node.type === "Component" || NAMED_DIRECTIVES.has(node.type)) {
    return [(node.name as string).split(".", 1)[0] ?? ""];
  }
  if (node.type === "StyleDirective" && node.value === true) {
    return [node.name as string];
  }
  return [];
}

function usedNames(root: AST.Root, removed: Array<[number, number]>) {
  const used = new Map<string, number>();
  const visit = (node: unknown, parent: Node | null, key: string): void => {
    if (Array.isArray(node)) {
      for (const item of node) {
        visit(item, parent, key);
      }
      return;
    }
    if (!isNode(node) || isRemoved(node.start, removed)) {
      return;
    }
    for (const name of namesIn(node, parent, key)) {
      used.set(name, (used.get(name) ?? 0) + 1);
    }
    if (node.type === "Identifier") {
      return;
    }
    for (const [childKey, value] of Object.entries(node)) {
      if (
        childKey !== "metadata" &&
        childKey !== "loc" &&
        typeof value === "object" &&
        value != null
      ) {
        visit(value, node, childKey);
      }
    }
  };
  visit(root.fragment, null, "");
  visit(root.instance?.content, null, "");
  visit(root.module?.content, null, "");
  return used;
}

function pruneSnippets(
  shared: Set<AST.SnippetBlock>,
  root: AST.Root,
  page: MagicString,
  removed: Array<[number, number]>,
) {
  const left = new Set(shared);
  let isChanged = left.size > 0;
  while (isChanged) {
    isChanged = false;
    const used = usedNames(root, removed);
    for (const snippet of left) {
      if (isRemoved(snippet.start, removed)) {
        left.delete(snippet);
      } else if ((used.get(snippet.expression.name) ?? 0) <= 1) {
        page.remove(snippet.start, snippet.end);
        removed.push([snippet.start, snippet.end]);
        left.delete(snippet);
        isChanged = true;
      }
    }
  }
}

function removeLine(node: Node, code: string, page: MagicString) {
  const lineEnd = code.indexOf("\n", node.end);
  const lineStart = code.lastIndexOf("\n", node.start - 1) + 1;
  const isOwnLine =
    lineEnd !== -1 &&
    code.slice(node.end, lineEnd).trim() === "" &&
    code.slice(lineStart, node.start).trim() === "";
  if (isOwnLine) {
    page.remove(lineStart, lineEnd + 1);
  } else {
    page.remove(node.start, node.end);
  }
}

function importClause(kept: Array<Node>, code: string) {
  const textOf = (specifier: Node) =>
    code.slice(specifier.start, specifier.end);
  const parts = kept
    .filter((specifier) => specifier.type !== "ImportSpecifier")
    .map((specifier) => textOf(specifier));
  const named = kept
    .filter((specifier) => specifier.type === "ImportSpecifier")
    .map((specifier) => textOf(specifier));
  if (named.length > 0) {
    parts.push(`{ ${named.join(", ")} }`);
  }
  return parts.join(", ");
}

function pruneImport(
  statement: Node,
  isKept: (local: string) => boolean,
  code: string,
  page: MagicString,
) {
  const specifiers = statement.specifiers as Array<Node>;
  const kept = specifiers.filter((specifier) =>
    isKept((specifier.local as Node).name as string),
  );
  if (kept.length === specifiers.length) {
    return;
  }
  if (kept.length === 0) {
    removeLine(statement, code, page);
    return;
  }
  page.overwrite(
    statement.start,
    (statement.source as Node).start,
    `import ${importClause(kept, code)} from `,
  );
}

function pruneImports(
  moved: Map<string, Imported>,
  root: AST.Root,
  code: string,
  page: MagicString,
  removed: Array<[number, number]>,
) {
  if (moved.size === 0) {
    return;
  }
  const used = usedNames(root, removed);
  const isKept = (local: string) =>
    !moved.has(local) || (used.get(local) ?? 0) > 0;
  for (const script of [root.instance, root.module]) {
    const statements = nodesOf(script?.content.body ?? []);
    for (const statement of statements) {
      if (
        statement.type === "ImportDeclaration" &&
        statement.importKind !== "type"
      ) {
        pruneImport(statement, isKept, code, page);
      }
    }
  }
}
