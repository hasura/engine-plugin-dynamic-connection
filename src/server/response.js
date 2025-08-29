import { createRequire } from 'module';
const require = createRequire(import.meta.url);
const { SpanStatusCode } = require("@opentelemetry/api");

// everything is fine, continue execution.
export const continue_ = ({ attributes, message }) => {
  const tracing = { code: SpanStatusCode.OK, message };
  return { attributes, response: null, status: 204, tracing };
};

// everything is fine, return the given value.
export const respond = ({ attributes, response, message }) => {
  const tracing = { code: SpanStatusCode.OK, message };
  return { attributes, response, status: 200, tracing };
};

// a user-caused error occurred.
export const userError = ({ attributes, response, message }) => {
  const tracing = { code: SpanStatusCode.ERROR, message };
  return { attributes, response, status: 400, tracing };
};

// a server-caused error occurred.
export const serverError = ({ attributes, response, message }) => {
  const tracing = { code: SpanStatusCode.ERROR, message };
  return { attributes, response, status: 500, tracing };
};
