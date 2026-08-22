/**
 * Minimal static file server for local playtesting (no dependencies).
 * Serves dist/ at http://localhost:6336 with no-cache headers.
 */
import { createServer } from "node:http";
import { readFileSync, existsSync } from "node:fs";
import { join, dirname, extname } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const distDir = join(root, "dist");
const PORT = Number(process.env.PORT ?? 6336);

const MIME: Record<string, string> = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".json": "application/json",
  ".png": "image/png",
  ".ico": "image/x-icon",
};

if (!existsSync(join(distDir, "index.html"))) {
  console.error("dist/index.html not found — run `npm run build:game` first.");
  process.exit(1);
}

createServer((req, res) => {
  const url = (req.url ?? "/").split("?")[0]!;
  const rel = url === "/" ? "/index.html" : url;
  const path = join(distDir, rel.replace(/\\/g, "/"));
  if (!path.startsWith(distDir)) {
    res.writeHead(403);
    res.end();
    return;
  }
  try {
    const data = readFileSync(path);
    res.writeHead(200, {
      "Content-Type": MIME[extname(path)] ?? "application/octet-stream",
      "Cache-Control": "no-store",
    });
    res.end(data);
  } catch {
    res.writeHead(404);
    res.end("not found");
  }
}).listen(PORT, () => {
  console.log(`Ember Depths playable at http://localhost:${PORT}`);
});
