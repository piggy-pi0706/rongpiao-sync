// 冲呀蓉漂！—— 零依赖云端同步后端
// 仅用 Node 内置模块，无需 npm install 任何第三方包。
// 职责：1) 托管前端 public/index.html（同源，前端 fetch('/api/state') 无 CORS）
//       2) 提供读写全量状态的接口，服务端用 data.json 原子写持久化。

const http = require("http");
const fs = require("fs");
const path = require("path");

const PORT = process.env.PORT || 3000;
const DATA_FILE = path.join(__dirname, "data.json");
const PUBLIC_DIR = path.join(__dirname, "public");
const MAX_BODY = 12 * 1024 * 1024; // 12MB 上限，防滥用（录音音频已在前端剥离，正常远小于此）

// ---- 数据读写（原子写：先写临时文件再 rename，避免半截文件）----
function readData() {
  try {
    return JSON.parse(fs.readFileSync(DATA_FILE, "utf8"));
  } catch (e) {
    return { state: null, version: 0, updatedAt: 0 };
  }
}
function writeData(obj) {
  const tmp = DATA_FILE + ".tmp";
  fs.writeFileSync(tmp, JSON.stringify(obj));
  fs.renameSync(tmp, DATA_FILE);
}

// ---- 静态文件托管 ----
const MIME = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".svg": "image/svg+xml",
  ".ico": "image/x-icon"
};
function serveStatic(req, res) {
  let urlPath = req.url.split("?")[0];
  if (urlPath === "/") urlPath = "/index.html";
  // 防目录穿越
  const safe = path.normalize(urlPath).replace(/^(\.\.[/\\])+/, "");
  const filePath = path.join(PUBLIC_DIR, safe);
  if (!filePath.startsWith(PUBLIC_DIR)) {
    res.writeHead(403);
    res.end("forbidden");
    return;
  }
  fs.readFile(filePath, function (err, data) {
    if (err) {
      res.writeHead(404);
      res.end("not found");
      return;
    }
    res.writeHead(200, { "Content-Type": MIME[path.extname(filePath)] || "application/octet-stream" });
    res.end(data);
  });
}

// ---- 主服务 ----
const server = http.createServer(function (req, res) {
  const pathOnly = req.url.split("?")[0];

  if (pathOnly === "/api/state") {
    if (req.method === "GET") {
      const d = readData();
      res.writeHead(200, { "Content-Type": "application/json; charset=utf-8" });
      res.end(JSON.stringify(d));
      return;
    }
    if (req.method === "POST") {
      let body = "";
      let tooBig = false;
      req.on("data", function (chunk) {
        body += chunk;
        if (body.length > MAX_BODY) {
          tooBig = true;
          req.destroy();
        }
      });
      req.on("end", function () {
        if (tooBig) {
          res.writeHead(413);
          res.end("payload too large");
          return;
        }
        try {
          const payload = JSON.parse(body);
          if (!payload || typeof payload !== "object" || !payload.state) {
            res.writeHead(400);
            res.end("bad request");
            return;
          }
          const cur = readData();
          const next = {
            state: payload.state,
            client: payload.client || "",
            version: (cur.version || 0) + 1,
            updatedAt: Date.now()
          };
          writeData(next);
          res.writeHead(200, { "Content-Type": "application/json; charset=utf-8" });
          res.end(JSON.stringify({ ok: true, version: next.version, updatedAt: next.updatedAt }));
        } catch (e) {
          res.writeHead(400);
          res.end("invalid json");
        }
      });
      return;
    }
    res.writeHead(405);
    res.end("method not allowed");
    return;
  }

  if (pathOnly === "/api/llm") {
    if (req.method === "POST") { llmProxy(req, res); return; }
    res.writeHead(405);
    res.end("method not allowed");
    return;
  }

  serveStatic(req, res);
});

// ---- LLM 代理（同源；API 密钥仅存服务端环境变量，前端不接触密钥，避免 CORS）----
const LLM_KEY = process.env.LLM_API_KEY || "";
const LLM_BASE = (process.env.LLM_BASE_URL || "https://api.deepseek.com/v1").replace(/\/$/, "");
const LLM_MODEL = process.env.LLM_MODEL || "deepseek-chat";

function llmProxy(req, res) {
  if (!LLM_KEY) {
    res.writeHead(200, { "Content-Type": "application/json; charset=utf-8" });
    res.end(JSON.stringify({ ok: false, error: "服务端未配置 LLM_API_KEY（请在 Render 环境变量中设置）" }));
    return;
  }
  let body = "";
  let tooBig = false;
  req.on("data", function (c) { body += c; if (body.length > 64 * 1024) { tooBig = true; req.destroy(); } });
  req.on("end", function () {
    if (tooBig) { res.writeHead(413); res.end("payload too large"); return; }
    let payload;
    try { payload = JSON.parse(body); } catch (e) { res.writeHead(400); res.end("invalid json"); return; }
    const base = (payload.base || LLM_BASE).replace(/\/$/, "");
    const model = payload.model || LLM_MODEL;
    let u;
    try { u = new URL(base + "/chat/completions"); } catch (e) { res.writeHead(400); res.end("bad base url"); return; }
    const reqBody = JSON.stringify({
      model: model,
      messages: [
        { role: "system", content: payload.system || "你是 helpful assistant。" },
        { role: "user", content: payload.user || "" }
      ],
      temperature: 0.3,
      response_format: { type: "json_object" }
    });
    const lib = u.protocol === "https:" ? require("https") : require("http");
    const opt = {
      method: "POST",
      hostname: u.hostname,
      port: u.port || (u.protocol === "https:" ? 443 : 80),
      path: u.pathname + u.search,
      headers: {
        "Content-Type": "application/json",
        "Authorization": "Bearer " + LLM_KEY,
        "Content-Length": Buffer.byteLength(reqBody)
      }
    };
    const p = lib.request(opt, function (r2) {
      let out = "";
      r2.on("data", function (c) { out += c; });
      r2.on("end", function () {
        try {
          const j = JSON.parse(out);
          const content = (j.choices && j.choices[0] && j.choices[0].message && j.choices[0].message.content) || "";
          let parsed = null;
          try { parsed = JSON.parse(content); } catch (e) { parsed = null; }
          if (parsed && typeof parsed === "object") {
            res.writeHead(200, { "Content-Type": "application/json; charset=utf-8" });
            res.end(JSON.stringify({ ok: true, score: parsed.score, verdict: parsed.verdict, covered: parsed.covered || [], suggestions: parsed.suggestions || [], model: model }));
          } else {
            res.writeHead(200, { "Content-Type": "application/json; charset=utf-8" });
            res.end(JSON.stringify({ ok: true, score: 0, verdict: "原文返回", covered: [], suggestions: [content.slice(0, 600)], model: model }));
          }
        } catch (e) {
          res.writeHead(502);
          res.end("llm upstream error: " + out.slice(0, 200));
        }
      });
    });
    p.on("error", function (e) {
      res.writeHead(502);
      res.end(JSON.stringify({ ok: false, error: "调用大模型失败：" + e.message }));
    });
    p.write(reqBody);
    p.end();
  });
}

server.listen(PORT, function () {
  console.log("冲呀蓉漂 sync server listening on :" + PORT);
});
