import { createRequire } from 'module';
const require = createRequire(import.meta.url);

const { BasicTracerProvider, BatchSpanProcessor } = require("@opentelemetry/sdk-trace-node");
const { OTLPTraceExporter } = require("@opentelemetry/exporter-trace-otlp-http");
const { registerInstrumentations } = require("@opentelemetry/instrumentation");
const { HttpInstrumentation } = require("@opentelemetry/instrumentation-http");
const { resourceFromAttributes } = require("@opentelemetry/resources");
const { trace } = require("@opentelemetry/api");

import { Config } from "./config.js";

const traceExporter = new OTLPTraceExporter({
  url: Config.otel_endpoint,
  headers: Config.otel_headers,
});

const provider = new BasicTracerProvider({
  resource: resourceFromAttributes({
    "service.name": "engine-plugin-dynamic-connection",
  }),
  spanProcessors: [new BatchSpanProcessor(traceExporter)]
});

trace.setGlobalTracerProvider(provider);

registerInstrumentations({ instrumentations: [new HttpInstrumentation()] });
export default trace.getTracer("engine-plugin-dynamic-connection");
