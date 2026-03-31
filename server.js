const express = require("express");
const cors = require("cors");
const app = express();
const PORT = process.env.PORT || 3000;

app.use(cors());
app.use(express.json({ limit: "20mb" }));

app.get("/", (req, res) => res.json({ status: "ok" }));
app.get("/health", (req, res) => res.json({ status: "ok" }));

// 把網址圖片轉成 base64
async function urlToBase64(url) {
  const r = await fetch(url);
  if (!r.ok) throw new Error("圖片下載失敗: " + r.status);
  const buf = await r.arrayBuffer();
  const type = r.headers.get("content-type") || "image/jpeg";
  const b64 = Buffer.from(buf).toString("base64");
  return `data:${type};base64,${b64}`;
}

// 檢查是否為網址，是的話轉 base64
async function resolveImage(val) {
  if (typeof val === "string" && val.startsWith("http")) {
    console.log("[下載圖片] " + val.substring(0, 80) + "...");
    return await urlToBase64(val);
  }
  return val;
}

app.post("/api/predict", async (req, res) => {
  const { model, input, token } = req.body;
  if (!model || !input || !token) return res.status(400).json({ error: "missing" });

  try {
    // 把所有圖片欄位的網址轉成 base64
    const resolved = { ...input };
    for (const key of ["human_img", "garm_img", "mask_img", "image"]) {
      if (resolved[key]) {
        resolved[key] = await resolveImage(resolved[key]);
      }
    }

    // 查模型版本
    console.log("[查詢] " + model);
    const info = await fetch(`https://api.replicate.com/v1/models/${model}`, {
      headers: { Authorization: `Bearer ${token}` },
    });

    if (!info.ok) {
      return res.status(info.status).json({ error: await info.text() });
    }

    const ver = (await info.json()).latest_version?.id;
    if (!ver) return res.status(404).json({ error: "找不到模型版本" });

    console.log("[版本] " + ver.substring(0, 12));

    // 建立預測
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
    console.log("[狀態] " + p.id + ": " + p.status);

    // 輪詢
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
