import http from "node:http";
import { readFile } from "node:fs/promises";
import { createReadStream, existsSync } from "node:fs";
import { extname, join, normalize } from "node:path";
import { fileURLToPath } from "node:url";
import { buildDashboardData } from "./analytics.js";
import { config } from "./config.js";
import { ensureStore } from "./store.js";

const publicDir = fileURLToPath(new URL("../public/", import.meta.url));
const mimeTypes = {
  ".html": "text/html; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".svg": "image/svg+xml",
};

await ensureStore();

const server = http.createServer(async (request, response) => {
  try {
    const url = new URL(request.url ?? "/", `http://${request.headers.host}`);
    if (url.pathname === "/api/dashboard") {
      const data = await buildDashboardData();
      sendJson(response, data);
      return;
    }

    await sendStatic(url.pathname, response);
  } catch (error) {
    response.writeHead(500, { "content-type": "application/json; charset=utf-8" });
    response.end(JSON.stringify({ error: error.message }));
  }
});

server.listen(config.serverPort, () => {
  console.log(`Spotify tracker dashboard: http://localhost:${config.serverPort}`);
});

function sendJson(response, body) {
  response.writeHead(200, {
    "content-type": "application/json; charset=utf-8",
    "cache-control": "no-store",
  });
  response.end(JSON.stringify(body));
}

async function sendStatic(pathname, response) {
  const safePath = normalize(decodeURIComponent(pathname)).replace(/^(\.\.[/\\])+/, "");
  const filePath = join(publicDir, safePath === "/" ? "index.html" : safePath);

  if (!filePath.startsWith(publicDir) || !existsSync(filePath)) {
    const fallback = await readFile(join(publicDir, "index.html"));
    response.writeHead(200, { "content-type": mimeTypes[".html"] });
    response.end(fallback);
    return;
  }

  response.writeHead(200, { "content-type": mimeTypes[extname(filePath)] ?? "application/octet-stream" });
  createReadStream(filePath).pipe(response);
}
