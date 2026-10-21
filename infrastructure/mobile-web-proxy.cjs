// Only the disposable Android UI runner: genuine Next/API responses, no mocks.
const http = require("node:http");
if (process.env.NODE_ENV !== "test")
  throw Error("UI proxy requires NODE_ENV=test");
http
  .createServer((req, res) => {
    const upstream = http.request(
      {
        hostname: "127.0.0.1",
        port: req.url.startsWith("/api/v1") ? 4100 : 3040,
        path: req.url,
        method: req.method,
        headers: req.headers,
      },
      (reply) => {
        res.writeHead(reply.statusCode, reply.headers);
        reply.pipe(res);
      },
    );
    upstream.on("error", () => {
      res.writeHead(502);
      res.end("Isolated UI service not ready");
    });
    req.pipe(upstream);
  })
  .listen(4199, "127.0.0.1");
