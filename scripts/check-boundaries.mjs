import { readdir, readFile } from "node:fs/promises";
import { dirname, relative, resolve } from "node:path";
import ts from "typescript";

const root = process.cwd();
const owners = new Map();
for (const group of ["apps", "packages"]) {
  for (const entry of await readdir(group, { withFileTypes: true }).catch(
    () => [],
  )) {
    if (entry.isDirectory()) {
      const base = resolve(group, entry.name);
      try {
        owners.set(
          base,
          JSON.parse(await readFile(`${base}/package.json`, "utf8")),
        );
      } catch {}
    }
  }
}
async function walk(path) {
  const files = [];
  for (const entry of await readdir(path, { withFileTypes: true }).catch(
    () => [],
  )) {
    if (["node_modules", "dist", ".next"].includes(entry.name)) continue;
    const full = resolve(path, entry.name);
    if (entry.isDirectory()) files.push(...(await walk(full)));
    else if (/\.[cm]?[jt]sx?$/.test(entry.name)) files.push(full);
  }
  return files;
}
const violations = [];
for (const [base, pkg] of owners) {
  for (const file of await walk(`${base}/src`)) {
    const source = ts.createSourceFile(
      file,
      await readFile(file, "utf8"),
      ts.ScriptTarget.Latest,
      true,
    );
    const specs = [];
    function visit(node) {
      if (
        (ts.isImportDeclaration(node) || ts.isExportDeclaration(node)) &&
        node.moduleSpecifier &&
        ts.isStringLiteral(node.moduleSpecifier)
      )
        specs.push(node.moduleSpecifier.text);
      if (
        ts.isCallExpression(node) &&
        (node.expression.kind === ts.SyntaxKind.ImportKeyword ||
          (ts.isIdentifier(node.expression) &&
            node.expression.text === "require"))
      ) {
        if (!node.arguments[0] || !ts.isStringLiteral(node.arguments[0]))
          violations.push(
            `${relative(root, file)}: nonliteral module loading is forbidden`,
          );
        else specs.push(node.arguments[0].text);
      }
      ts.forEachChild(node, visit);
    }
    visit(source);
    for (const spec of specs) {
      const label = `${relative(root, file)}: ${spec}`;
      if (spec.startsWith(".")) {
        const target = resolve(dirname(file), spec);
        if (!target.startsWith(`${base}/`))
          violations.push(`${label} escapes package boundary`);
      }
      if (spec.startsWith("@craftlayer/")) {
        const name = spec.split("/").slice(0, 2).join("/");
        if (!pkg.dependencies?.[name])
          violations.push(`${label} is not a declared dependency`);
        if (
          pkg.name === "@craftlayer/web" &&
          !["@craftlayer/contracts", "@craftlayer/sdk"].includes(name)
        )
          violations.push(`${label} exposes a server package to web`);
        if (["@craftlayer/core", "@craftlayer/contracts"].includes(pkg.name))
          violations.push(`${label} violates pure domain boundary`);
      }
      if (
        pkg.name === "@craftlayer/web" &&
        /^(pg|redis|pino|drizzle-orm|fastify|node:)/.test(spec)
      )
        violations.push(`${label} is forbidden in dashboard source`);
    }
  }
}
if (violations.length) {
  console.error(violations.join("\n"));
  process.exitCode = 1;
} else console.log("Package boundaries: PASS");
