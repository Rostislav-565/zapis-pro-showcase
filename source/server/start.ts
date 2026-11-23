import { createServer } from "node:http";
import { existsSync } from "node:fs";
import { readFile, stat } from "node:fs/promises";
import { extname, resolve, sep } from "node:path";
import { api } from "./api.ts";

const root = resolve("dist");
if (!existsSync(resolve(root, "index.html"))) throw new Error("Сначала выполните npm run build");
const formats: Record<string, string> = {
  ".html": "text/html; charset=utf-8", ".js": "text/javascript; charset=utf-8", ".css": "text/css; charset=utf-8",
  ".svg": "image/svg+xml", ".png": "image/png", ".webp": "image/webp", ".woff2": "font/woff2", ".woff": "font/woff",
  ".webmanifest": "application/manifest+json",
};
const server = createServer(async (req, res) => {
  if (req.url?.startsWith("/api/")) return api(req, res);
  if (req.method !== "GET" && req.method !== "HEAD") { res.writeHead(405).end(); return; }
  try {
    const path = decodeURIComponent(new URL(req.url || "/", "http://localhost").pathname);
    const file = resolve(root, "." + path);
    if (file !== root && !file.startsWith(root + sep)) { res.writeHead(404).end(); return; }
    const isFile = file !== root && (await stat(file).catch(() => null))?.isFile();
    if (!isFile && extname(path)) { res.writeHead(404).end(); return; }
    const target = isFile ? file : resolve(root, "index.html");
    res.writeHead(200, {
      "Content-Type": formats[extname(target)] || "application/octet-stream",
      "X-Content-Type-Options": "nosniff", "Referrer-Policy": "no-referrer",
      "Cache-Control": target.startsWith(resolve(root, "assets") + sep) ? "public, max-age=31536000, immutable" : "no-cache",
    });
    res.end(req.method === "HEAD" ? undefined : await readFile(target));
  } catch { if (!res.headersSent) res.writeHead(400); res.end(); }
});
const host = process.env.HOST || "127.0.0.1";
const port = Number(process.env.PORT || "4173");
server.listen(port, host, () => console.log("ЗаписьПро · http://" + host + ":" + port));
