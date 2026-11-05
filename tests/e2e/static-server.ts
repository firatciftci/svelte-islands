import { readFile } from "node:fs/promises";
import { createServer } from "node:http";
import { extname, join, normalize } from "node:path";

const [root = ".", port = "5303"] = process.argv.slice(2);

const TYPES: Record<string, string> = {
  ".css": "text/css",
  ".html": "text/html",
  ".js": "text/javascript",
  ".json": "application/json",
};

async function read(path: string) {
  const safe = normalize(path).replace(/^(?:\.\.[/\\])+/u, "");
  for (const candidate of [safe, `${safe}.html`]) {
    try {
      return {
        type: extname(candidate),
        body: await readFile(join(root, candidate)),
      };
    } catch {
      continue;
    }
  }
  return null;
}

createServer((request, response) => {
  const { pathname } = new URL(request.url ?? "/", "http://localhost");
  void read(decodeURIComponent(pathname)).then((found) => {
    if (found == null) {
      response.writeHead(404);
      response.end();
      return;
    }
    response.writeHead(200, {
      "content-type": TYPES[found.type] ?? "application/octet-stream",
    });
    response.end(found.body);
  });
}).listen(Number(port), "127.0.0.1");
