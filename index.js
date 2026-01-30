import { app } from "./src/server.js";
import logger from "./src/logger.js";
import { Config } from "./src/config.js";

const PORT = process.env.PORT || Config.port || 8787;
const HOST = process.env.HOST || Config.host || "0.0.0.0";

const server = app.listen(PORT, HOST, () => {
  logger.info("Dynamic connection plugin server started", {
    port: PORT,
    host: HOST,
    environment: process.env.NODE_ENV || 'development'
  });
});

// Graceful shutdown handling
const gracefulShutdown = (signal) => {
  logger.info(`Received ${signal}, starting graceful shutdown...`);

  server.close((err) => {
    if (err) {
      logger.error("Error during server shutdown", { error: err.message });
      process.exit(1);
    }

    logger.info("Server closed successfully");
    process.exit(0);
  });

  // Force shutdown after 10 seconds if graceful shutdown fails
  setTimeout(() => {
    logger.error("Forced shutdown after timeout");
    process.exit(1);
  }, 10000);
};

// Handle termination signals
process.on('SIGTERM', () => gracefulShutdown('SIGTERM'));
process.on('SIGINT', () => gracefulShutdown('SIGINT'));

// Handle uncaught exceptions
process.on('uncaughtException', (error) => {
  logger.error("Uncaught exception", { error: error.message });
  gracefulShutdown('uncaughtException');
});

// Handle unhandled promise rejections
process.on('unhandledRejection', (reason) => {
  logger.error("Unhandled promise rejection", { reason: String(reason) });
});
