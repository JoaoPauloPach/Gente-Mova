import express from "express";
import { fileURLToPath } from "url";
import { dirname, join } from "path";
import { chat } from "./agent.js";

const __dirname = dirname(fileURLToPath(import.meta.url));
const app = express();
const PORT = process.env.PORT || 3000;

app.use(express.json());
app.use(express.static(join(__dirname, "../public")));

// Armazena histórico por sessão (em memória — suficiente para hackathon)
const sessions = {};

app.post("/api/chat", async (req, res) => {
  const { message, session_id } = req.body;
  const api_key = (req.body.api_key || "").trim();
  if (!message) return res.status(400).json({ error: "message obrigatório" });
  if (!api_key) return res.status(400).json({ error: "api_key obrigatório" });

  console.log(`[Server] api_key recebida: ${api_key.slice(0, 10)}... (${api_key.length} chars)`);

  const sid = session_id || "default";
  if (!sessions[sid]) sessions[sid] = [];

  try {
    const { reply, updatedHistory } = await chat(sessions[sid], message, api_key);
    sessions[sid] = updatedHistory;
    res.json({ reply, session_id: sid });
  } catch (err) {
    console.error("[Server] Erro:", err);
    res.status(500).json({ error: err.message });
  }
});

app.post("/api/reset", (req, res) => {
  const { session_id } = req.body;
  const sid = session_id || "default";
  sessions[sid] = [];
  res.json({ ok: true, message: "Sessão reiniciada." });
});

// Localmente sobe o servidor normalmente; no Vercel exporta o app
if (!process.env.VERCEL) {
  app.listen(PORT, () => {
    console.log(`Mova rodando em http://localhost:${PORT}`);
  });
}

export default app;
