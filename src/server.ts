import dotenv from "dotenv";
dotenv.config();

import app from "./app";
import { env } from "./config/env";

// ── Unhandled promise rejections ─────────────────────────────────────────────
process.on("unhandledRejection", (reason) => {
  console.error("[unhandledRejection]", reason);
  process.exit(1);
});

// ── Uncaught exceptions ──────────────────────────────────────────────────────
process.on("uncaughtException", (err) => {
  console.error("[uncaughtException]", err);
  process.exit(1);
});

// ── Start server ─────────────────────────────────────────────────────────────
const server = app.listen(env.PORT, () => {
  console.log(`[SmarTrans] Server running on port ${env.PORT} (${env.NODE_ENV})`);
});

// ── Graceful shutdown ────────────────────────────────────────────────────────
function shutdown(signal: string) {
  console.log(`[SmarTrans] ${signal} received — shutting down gracefully`);
  server.close(() => {
    console.log("[SmarTrans] HTTP server closed");
    process.exit(0);
  });
  setTimeout(() => process.exit(1), 10_000).unref();
}

process.on("SIGTERM", () => shutdown("SIGTERM"));
process.on("SIGINT", () => shutdown("SIGINT"));
