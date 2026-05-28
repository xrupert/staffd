import { Hono } from "hono";
import { cors } from "hono/cors";
import { logger } from "hono/logger";
import { agentRouter } from "./routes/agent";
import { orchestrateRouter } from "./routes/orchestrate";
import { healthRouter } from "./routes/health";

const app = new Hono();

// ── Middleware ────────────────────────────────────────────────────────────────

app.use("*", logger());

app.use(
  "*",
  cors({
    origin: [
      "http://localhost:3000",
      "https://urstaffd.com",
      "https://www.urstaffd.com",
    ],
    allowHeaders: ["Content-Type", "Authorization"],
    allowMethods: ["GET", "POST", "OPTIONS"],
  })
);

// ── Routes ────────────────────────────────────────────────────────────────────

app.route("/health", healthRouter);
app.route("/agent", agentRouter);
app.route("/orchestrate", orchestrateRouter);

// ── 404 ───────────────────────────────────────────────────────────────────────

app.notFound((c) => c.json({ error: "Not found" }, 404));

// ── Error handler ─────────────────────────────────────────────────────────────

app.onError((err, c) => {
  console.error("API error:", err);
  return c.json({ error: "Internal server error" }, 500);
});

// ── Start ─────────────────────────────────────────────────────────────────────

const PORT = Number(process.env.PORT ?? 3001);

export default {
  port: PORT,
  fetch: app.fetch,
};

console.log(`STAFFD API running on http://localhost:${PORT}`);
