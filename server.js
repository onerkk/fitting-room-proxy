const express = require("express");
const cors = require("cors");
const app = express();
const PORT = process.env.PORT || 3000;

app.use(cors());
app.use(express.json({ limit: "20mb" }));

app.get("/", (req, res) => res.json({ status: "ok" }));
app.get("/health", (req, res) => res.json({ status: "ok" }));

// 把 base64 或 URL 圖片上傳到 Replicate，拿回可用的網址
async function uploadToReplicate(val, token) {
  if (!val) return val;

  let buf, contentType;

  if (typeof val === "string" && val.startsWith("data:")) {
    // base64 data URI
    const match = val.match(/^data:([^;]+);base64,(.+)$/);
    if (!match) return val;
    contentType = match[1];
    buf = Buffer.from(match[2], "base64");
  } else if (typeof val === "string" && val.startsWith("http")) {
    // URL - 下載
    console.log("[下載] " + val.substring(0, 60));
    const r = await fetch(val);
    if (!r.ok) return val;
    contentType = r.headers.get("content-type") || "image/jpeg";
    buf = Buffer.from(await r.arrayBuffer());
  } else {
    return val;
  }

  // 上傳到 Replicate Files API
  const ext = contentType.includes("png") ? "png" : "jpg";
  const boundary = "----FormBoundary" + Date.now();
  const header = `--${boundary}\r\nContent-Disposition: form-data; name="content"; filename="image.${ext}"\r\nContent-Type: ${contentType}\r\n\r\n`;
  const footer = `\r\n--${boundary}--\r\n`;

  const body = Buffer.concat([
    Buffer.from(header),
    buf,
    Buffer.from(footer),
  ]);

  console.log("[上傳] " + (buf.length / 1024).toFixed(0) + "KB");

  const r = await fetch("https://api.replicate.com/v1/files", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${token}`,
      "Content-Type": `multipart/form-data; boundary=${boundary}`,
    },
    body,
  });

  if (!r.ok) {
    console.error("[上傳失敗] " + r.status);
    // 失敗就回傳原始值
    return val;
  }

  const data = await r.json();
  console.log("[上傳成功] " + data.urls?.get);
  return data.urls?.get || val;
}

app.post("/api/predict", async (req, res) => {
  const { model, input, token } = req.body;
  if (!model || !input || !token) return res.status(400).json({ error: "missing" });

  try {
    // 圖片欄位上傳到 Replicate
    const resolved = { ...input };
    const imgFields = ["human_img", "garm_img", "mask_img", "image"];
    for (const key of imgFields) {
      if (resolved[key]) {
        resolved[key] = await uploadToReplicate(resolved[key], token);
      }
    }

    // 查模型版本
    console.log("[查詢] " + model);
    const info = await fetch(`https://api.replicate.com/v1/models/${model}`, {
      headers: { Authorization: `Bearer ${token}` },
    });
    if (!info.ok) return res.status(info.status).json({ error: await info.text() });

    const ver = (await info.json()).latest_version?.id;
    if (!ver) return res.status(404).json({ error: "找不到版本" });

    // 建立預測
    console.log("[預測] 版本 " + ver.substring(0, 12));
    const r = await fetch("https://api.replicate.com/v1/predictions", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${token}`,
        "Content-Type": "application/json",
        Prefer: "wait=60",
      },
      body: JSON.stringify({ version: ver, input: resolved }),
    });

    if (!r.ok) return res.status(r.status).json({ error: await r.text() });

    let p = await r.json();
    console.log("[狀態] " + p.status);

    if (p.status !== "succeeded" && p.status !== "failed") {
      for (let i = 0; i < 90; i++) {
        await new Promise((r) => setTimeout(r, 2000));
        const poll = await fetch(p.urls.get, {
          headers: { Authorization: `Bearer ${token}` },
        });
        p = await poll.json();
        if (p.status === "succeeded" || p.status === "failed") break;
      }
    }

    if (p.status === "failed") return res.status(500).json({ error: p.error || "生成失敗" });
    res.json({ output: p.output, status: p.status });
  } catch (e) {
    console.error("[例外] " + e.message);
    res.status(500).json({ error: e.message });
  }
});

app.listen(PORT, () => console.log("proxy running on " + PORT));
