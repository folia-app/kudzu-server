const http = require("http");
const url = require("url");

const { handler } = require("./img");

const port = process.env.PORT || 8080;

http
  .createServer(async (req, res) => {
    if (req.url === "/healthz") {
      res.writeHead(200, { "content-type": "text/plain" });
      res.end("ok");
      return;
    }
    try {
      const u = url.parse(req.url, true);
      const event = {
        path: u.pathname,
        queryStringParameters: u.query || {},
      };
      const result = await handler(event, {});
      const headers = Object.assign(
        {
          "cache-control": "public, s-maxage=86400, stale-while-revalidate=604800",
          "access-control-allow-origin": "*",
        },
        result.headers || {}
      );
      res.writeHead(result.statusCode || 200, headers);
      if (result.isBase64Encoded) {
        res.end(Buffer.from(result.body, "base64"));
      } else {
        res.end(result.body || "");
      }
    } catch (e) {
      console.error(e);
      res.writeHead(500, { "content-type": "text/plain" });
      res.end("internal error");
    }
  })
  .listen(port, () => {
    console.log(`kudzu-img listening on ${port}`);
  });
