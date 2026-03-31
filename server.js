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
  if (!model || !input || !token) return res.status(400).json({ error: "缺少參數" });

  try {
    console.log(`[請求] ${model}`);
    const r = await fetch(`https://api.replicate.com/v1/models/${model}/predictions`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${token}`,
        "Content-Type": "application/json",
        Prefer: "wait=120",
      },
      body: JSON.stringify({ input }),
    });

    if (!r.ok) {
      const e = await r.text();
      console.error(`[錯誤] ${r.status}: ${e}`);
      return res.status(r.status).json({ error: e });
    }

    let pred = await r.json();
    console.log(`[狀態] ${pred.id}: ${pred.status}`);

    if (pred.status !== "succeeded" && pred.status !== "failed") {
      for (let i = 0; i < 60; i++) {
        await new Promise((r) => setTimeout(r, 2000));
        const poll = await fetch(pred.urls.get, {
          headers: { Authorization: `Bearer ${token}` },
        });
        pred = await poll.json();
        console.log(`[輪詢 ${i + 1}] ${pred.status}`);
        if (pred.status === "succeeded" || pred.status === "failed") break;
      }
    }

    if (pred.status === "failed")
      return res.status(500).json({ error: pred.error || "生成失敗" });

    res.json({ output: pred.output, status: pred.status });
  } catch (e) {
    console.error(`[例外] ${e.message}`);
    res.status(500).json({ error: e.message });
  }
});

app.listen(PORT, () => console.log(`代理伺服器啟動 port ${PORT}`));
