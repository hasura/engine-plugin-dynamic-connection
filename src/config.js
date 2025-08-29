export const Config = {
  // Hasura secret to verify the sender. Replace with your new secret.
  headers: { "hasura-m-auth": "zZkhKqFjqXR4g5MZCsJUZCnhCcoPyZ" },

  // List of connection names for read replicas
  replica_connection_names: ["replica1", "replica2", "replica3"],

  // Primary connection name for mutations and no-stale queries
  primary_connection_name: "primary",

  // The URL for an opentelemetry collector.
  otel_endpoint: "https://gateway.otlp.hasura.io:443/v1/traces",

  // Any other OpenTelemetry headers to send to the collector.
  // otel_headers: { Authorization: 'pat <my-personal-access-token>' }
  otel_headers: {
    Authorization: "pat <your-personal-access-token>"
  },
};
