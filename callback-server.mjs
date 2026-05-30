import http from "node:http";

const port = Number(process.env.SUNO_CALLBACK_PORT || 8787);

const server = http.createServer(async (req, res) => {
  if (req.method !== "POST" || req.url !== "/suno/callback") {
    res.writeHead(404, { "Content-Type": "application/json" });
    res.end(JSON.stringify({ ok: false, error: "not_found" }));
    return;
  }

  let body = "";
  for await (const chunk of req) body += chunk;

  const stamp = new Date().toISOString();
  console.log(`\n[${stamp}] Suno callback received:`);
  console.log(body);

  res.writeHead(200, { "Content-Type": "application/json" });
  res.end(JSON.stringify({ ok: true }));
});

server.listen(port, "0.0.0.0", () => {
  console.log(`Suno callback server listening on http://0.0.0.0:${port}/suno/callback`);
  console.log("Expose it with Cloudflare Tunnel/ngrok and set SUNO_CALLBACK_URL to the public URL.");
});
