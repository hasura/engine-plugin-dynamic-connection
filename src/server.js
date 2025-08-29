import express from "express";
import { withTrace } from "./server/control.js";
import dynamicConnectionHandler from "./routes/dynamic-connection.js";
import tracer from "./tracing.js";
import logger from "./logger.js";

const app = express();

// Middleware for parsing JSON with larger limit for webhook payloads
app.use(express.json({ limit: "50mb" }));

// Log application startup
logger.info("Dynamic connection plugin starting up", {
  nodeVersion: process.version,
  logLevel: process.env.LOG_LEVEL || 'INFO'
});

// Health check endpoint (compatible with both /ping and /health)
app.get("/ping", (_req, res) => {
  logger.debug("Health check requested");
  res.json({ status: "ok" });
});

app.get("/health", (_req, res) => {
  logger.debug("Health check requested");
  res.status(200).json({ status: "healthy" });
});

// Main dynamic connection endpoint with tracing
app.post("/pre/ndc", withTrace(tracer, "dynamic-connection", dynamicConnectionHandler));



// 404 handler
app.use((req, res) => {
  logger.warn("404 Not Found", {
    method: req.method,
    path: req.url,
    userAgent: req.get('User-Agent')
  });
  res.status(404).json({ error: "Not found" });
});

// Export the app for use in index.js
export { app };