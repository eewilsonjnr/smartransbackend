import express from "express";
import cors from "cors";
import helmet from "helmet";
import morgan from "morgan";

import { env } from "./config/env";
import { AppError } from "./common/app-error";
import { alertsRouter } from "./modules/alerts/alerts.routes";
import { assignmentsRouter } from "./modules/assignments/assignments.routes";
import { auditLogsRouter } from "./modules/auditLogs/auditLogs.routes";
import { authoritiesRouter } from "./modules/authorities/authorities.routes";
import { authRouter } from "./modules/auth/auth.routes";
import { carOwnersRouter } from "./modules/carOwners/carOwners.routes";
import { driversRouter } from "./modules/drivers/drivers.routes";
import { organizationsRouter } from "./modules/organizations/organizations.routes";
import { reportsRouter } from "./modules/reports/reports.routes";
import { routeTemplatesRouter } from "./modules/routeTemplates/routeTemplates.routes";
import { tripsRouter } from "./modules/trips/trips.routes";
import { vehiclesRouter } from "./modules/vehicles/vehicles.routes";
import { violationsRouter } from "./modules/violations/violations.routes";
import { errorHandler, notFoundHandler } from "./middleware/error-handler";

const app = express();

// ── Security headers ────────────────────────────────────────────────────────
app.use(helmet());

// ── CORS ────────────────────────────────────────────────────────────────────
const allowedOrigins = new Set([
  "https://smartransfrontend.vercel.app",
  "https://smartransconnect.vercel.app",
  ...(env.ALLOWED_ORIGINS ? env.ALLOWED_ORIGINS.split(",").map((o) => o.trim()) : []),
]);

app.use(
  cors({
    origin:
      env.NODE_ENV === "production"
        ? (origin, callback) => {
            // Allow requests with no origin (mobile apps, Postman) or whitelisted origins
            if (!origin || allowedOrigins.has(origin.replace(/\/+$/, ""))) {
              callback(null, true);
            } else {
              callback(new AppError(403, `Origin ${origin} not allowed by CORS policy.`));
            }
          }
        : true, // open in development
    credentials: true,
    methods: ["GET", "POST", "PATCH", "PUT", "DELETE", "OPTIONS"],
    allowedHeaders: ["Content-Type", "Authorization", "X-Refresh-Token"],
  }),
);

// ── Request logging ─────────────────────────────────────────────────────────
app.use(morgan(env.NODE_ENV === "production" ? "combined" : "dev"));

// ── Body parsing ─────────────────────────────────────────────────────────────
app.use(express.json({ limit: "256kb" }));

// ── Health check ─────────────────────────────────────────────────────────────
const healthResponse = { success: true, message: "SmarTrans backend is running", env: env.NODE_ENV };

app.get("/", (_req, res) => {
  res.json(healthResponse);
});

app.get(["/health", "/api/health"], (_req, res) => {
  res.json(healthResponse);
});

// ── Routes ───────────────────────────────────────────────────────────────────
app.use("/api/auth", authRouter);
app.use("/api/organizations", organizationsRouter);
app.use("/api/authorities", authoritiesRouter);
app.use("/api/drivers", driversRouter);
app.use("/api/car-owners", carOwnersRouter);
app.use("/api/vehicles", vehiclesRouter);
app.use("/api/assignments", assignmentsRouter);
app.use("/api/trips", tripsRouter);
app.use("/api/violations", violationsRouter);
app.use("/api/alerts", alertsRouter);
app.use("/api/reports", reportsRouter);
app.use("/api/audit-logs", auditLogsRouter);
app.use("/api/route-templates", routeTemplatesRouter);

// ── Error handling ───────────────────────────────────────────────────────────
app.use(notFoundHandler);
app.use(errorHandler);

export default app;
