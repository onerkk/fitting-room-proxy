const express = require("express");
const cors = require("cors");
const app = express();
const PORT = process.env.PORT || 3000;

app.use(cors());
app.use(express.json({ limit: "20mb" }));

app.get("/", (req, res) => res.json({ status: "ok" }));
app.get("/health", (req, res) => res.json({ status: "ok" }));

app.post("/api/predict", async (req, res) => {
  const { model, input, token } = req.body;
  if (!model || !input || !token) return res.status(400).json({ error: "missing" });

  try {
    // 先查模型最新版本
    console.log("[查詢] " + model);
    const info = await fetch(`https://api.replicate.com/v1/models/${model}`, {
      headers: { Authorization: `Bearer ${token}` },
    });

    if (!info.ok) {
      const e = await info.text();
      console.error("[查詢失敗] " + e);
      return res.status(info.status).json({ error: e });
    }

    const modelData = await info.json();
    const version = modelData.latest_version?.id;

    if (!version) {
      return res.status(404).json({ error: "找不到模型版本" });
    }

    console.log("[版本] " + version);

    // 用版本號建立預測
    const r = await fetch("https://api.replicate.com/v1/predictions", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${token}`,
        "Content-Type": "application/json",
        Prefer: "wait=60",
      },
      body: JSON.stringify({ version, input }),
    });

    if (!r.ok) {
      const e = await r.text();
      console.error("[預測失敗] " + e);
      return res.status(r.status).json({ error: e });
    }

    let p = await r.json();
    console.log("[狀態] " + p.id + ": " + p.status);

    // 輪詢等待完成
    if (p.status !== "succeeded" && p.status !== "failed") {
      for (let i = 0; i < 60; i++) {
        await new Promise((r) => setTimeout(r, 2000));
        const poll = await fetch(p.urls.get, {
          headers: { Authorization: `Bearer ${token}` },
        });
        p = await poll.json();
        console.log("[輪詢 " + (i+1) + "] " + p.status);
        if (p.status === "succeeded" || p.status === "failed") break;
      }
    }

    if (p.status === "failed") return res.status(500).json({ error: p.error });
    res.json({ output: p.output, status: p.status });
  } catch (e) {
    console.error("[例外] " + e.message);
    res.status(500).json({ error: e.message });
  }
});

app.listen(PORT, () => console.log("proxy running on " + PORT));
