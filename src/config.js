export const Config = {
  // Hasura secret to verify the sender. Replace with your new secret.
  headers: { "hasura-m-auth": "zZkhKqFjqXR4g5MZCsJUZCnhCcoPyZ" },

  // Header name for read replica connection names
  replica_connection_names_header_name: "hasura-replica-connection-names",

  // Header name for primary connection name
  primary_connection_name_header_name: "hasura-primary-connection-name",

  // Header name for project identifier
  project_id_header_name: "hasura-unique-project-id",

  // The URL for an opentelemetry collector.
  otel_endpoint: "https://gateway.otlp.hasura.io:443/v1/traces",

  // Any other OpenTelemetry headers to send to the collector.
  // otel_headers: { Authorization: 'pat <my-personal-access-token>' }
  otel_headers: {
    Authorization: "pat <your-personal-access-token>"
  },
};
