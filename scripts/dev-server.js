const fs = require("fs");
const http = require("http");
const path = require("path");
const { root, publicConfig } = require("./env");

const port = Number(process.env.PORT) || 3000;
const types = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".svg": "image/svg+xml",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".png": "image/png",
  ".webp": "image/webp",
  ".ico": "image/x-icon",
};

function isHidden(pathname) {
  return pathname
    .split("/")
    .some((part) => part.startsWith(".") && part !== ".well-known");
}

function send(res, status, body, type) {
  res.writeHead(status, {
    "Content-Type": type || "text/plain; charset=utf-8",
    "Cache-Control": "no-store",
  });
  res.end(body);
}

const server = http.createServer((req, res) => {
  const url = new URL(req.url, `http://${req.headers.host || "127.0.0.1"}`);
  if (url.pathname === "/api/config") {
    const config = publicConfig();
    if (config.error) {
      console.error(config.error);
      send(res, 500, JSON.stringify({ configured: false }), "application/json; charset=utf-8");
      return;
    }
    send(
      res,
      200,
      JSON.stringify({
        configured: Boolean(config.configured),
        url: config.url || "",
        anonKey: config.anonKey || "",
      }),
      "application/json; charset=utf-8"
    );
    return;
  }

  let pathname = decodeURIComponent(url.pathname);
  if (isHidden(pathname)) {
    send(res, 404, "No encontrado");
    return;
  }
  if (pathname.endsWith("/")) pathname += "index.html";
  const filePath = path.resolve(root, `.${pathname}`);
  const relative = path.relative(root, filePath);
  if (relative.startsWith("..") || path.isAbsolute(relative)) {
    send(res, 403, "Prohibido");
    return;
  }
  fs.stat(filePath, (error, stat) => {
    const resolved = !error && stat.isDirectory() ? path.join(filePath, "index.html") : filePath;
    fs.readFile(resolved, (readError, data) => {
      if (readError) {
        send(res, 404, "No encontrado");
        return;
      }
      const type = types[path.extname(resolved).toLowerCase()] || "application/octet-stream";
      send(res, 200, data, type);
    });
  });
});

server.listen(port, "127.0.0.1", () => {
  const config = publicConfig();
  console.log(`http://127.0.0.1:${port}`);
  console.log(config.configured ? "Supabase configurado" : "Supabase sin configurar: el catálogo usa catalog.js");
});
