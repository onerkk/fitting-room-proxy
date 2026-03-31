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
    const info = await fetch(`https://api.replicate.com/v1/models/${model}`, {
      headers: { Authorization: `Bearer ${token}` },
    });
    if (!info.ok) return res.status(info.status).json({ error: await info.text() });
    const ver = (await info.json()).latest_version?.id;
    if (!ver) return res.status(404).json({ error: "no version" });

    const r = await fetch("https://api.replicate.com/v1/predictions", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${token}`,
        "Content-Type": "application/json",
        Prefer: "wait=60",
      },
      body: JSON.stringify({ version: ver, input }),
    });
    if (!r.ok) return res.status(r.status).json({ error: await r.text() });

    let p = await r.json();

    if (p.status !== "succeeded" && p.status !== "failed") {
      for (let i = 0; i < 90; i++) {
        await new Promise(r => setTimeout(r, 2000));
        const poll = await fetch(p.urls.get, { headers: { Authorization: `Bearer ${token}` } });
        p = await poll.json();
        if (p.status === "succeeded" || p.status === "failed") break;
      }
    }

    if (p.status === "failed") return res.status(500).json({ error: p.error || "failed" });
    res.json({ output: p.output, status: p.status });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

app.listen(PORT, () => console.log("proxy on " + PORT));
