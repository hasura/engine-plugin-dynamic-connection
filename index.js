import { app } from "./src/server.js";
import logger from "./src/logger.js";
import { Config } from "./src/config.js";

const PORT = process.env.PORT || Config.port || 8787;
const HOST = process.env.HOST || Config.host || "0.0.0.0";

app.listen(PORT, HOST, () => {
  logger.info("Dynamic connection plugin server started", {
    port: PORT,
    host: HOST,
    environment: process.env.NODE_ENV || 'development'
  });
});
