# Dynamic Connection Plugin for Hasura

This repository contains a dynamic connection plugin for Hasura. The plugin is built using Node.js and Express.js. It
provides dynamic connection routing for pre-NDC requests, routing mutations to the primary database and queries to read
replicas using round-robin.

A sample hml file for the plugin:
```yaml
kind: LifecyclePluginHook
version: v1
definition:
  pre: ndcRequest
  name: dynamic_routing
  url:
    valueFromEnv: APP_PRE_NDC_WEBHOOK_URL
  connectors:
    - postgres
  config:
    request:
      headers:
        "hasura-m-auth":
          valueFromEnv: APP_PRE_NDC_WEBHOOK_TOKEN
        "hasura-replica-connection-names":
          valueFromEnv: APP_REPLICA_CONNECTION_NAMES
        "hasura-primary-connection-name":
          valueFromEnv: APP_PRIMARY_CONNECTION_NAME
      session: {}
      ndcRequest: {}
```

The environment variables to be set are:

- `APP_PRE_NDC_WEBHOOK_URL`: The URL of the plugin. Eg. `http://localhost:8787/pre/ndc`
- `APP_PRE_NDC_WEBHOOK_TOKEN`: The token to authenticate requests to the plugin. Eg. `zZkhKqFjqXR4g5MZCsJUZCnhCcoPyZ`
- `APP_REPLICA_CONNECTION_NAMES`: A comma-separated list of replica connection names. Eg. `replica1,replica2,replica3`
- `APP_PRIMARY_CONNECTION_NAME`: The name of the primary connection. Eg. `primary`
