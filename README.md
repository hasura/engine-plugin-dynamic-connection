# Dynamic Connection Plugin for Hasura DDN

A [pre-NDC request plugin](https://hasura.io/docs/3.0/plugins/introduction#pre-ndc-request-plugin) that routes mutations to your primary database and distributes queries across read replicas using round-robin load balancing.

## Architecture

```mermaid
graph LR
    Client[Client] --> DDN[Hasura DDN Engine]
    DDN --> Plugin[Dynamic Connection Plugin]
    Plugin --> Connector[Data Connector]
    Connector --> Primary[(Primary DB)]
    Connector --> Replica1[(Replica 1)]
    Connector --> Replica2[(Replica 2)]

    Plugin -.->|mutation| Primary
    Plugin -.->|query round-robin| Replica1
    Plugin -.->|query round-robin| Replica2
    Plugin -.->|read-no-stale| Primary
```

The plugin sits between Hasura DDN and your data connector, inspecting each request and injecting the appropriate `connection_name` based on the operation type.

## Quick Start

### 1. Run the Plugin

```bash
docker run -p 8787:8787 \
  -e APP_PRE_NDC_WEBHOOK_TOKEN=your-secret-token \
  ghcr.io/hasura/engine-plugin-dynamic-connection:latest
```

Or from source:
```bash
npm install && npm start
```

### 2. Configure Hasura DDN

Create `app/metadata/dynamic-routing.hml`:

```yaml
kind: LifecyclePluginHook
version: v1
definition:
  pre: ndcRequest
  name: dynamic_routing
  url:
    valueFromEnv: APP_PRE_NDC_WEBHOOK_URL
  connectors:
    - postgres  # Replace with your connector name
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

### Environment Variables

#### Required Variables

| Variable | Description | Example |
|----------|-------------|---------|
| `APP_PRE_NDC_WEBHOOK_URL` | URL where the plugin is hosted | `http://localhost:8787/pre/ndc` |
| `APP_PRE_NDC_WEBHOOK_TOKEN` | Authentication token for the plugin | `zZkhKqFjqXR4g5MZCsJUZCnhCcoPyZ` |
| `APP_REPLICA_CONNECTION_NAMES` | Comma-separated list of read replica connection names | `replica1,replica2,replica3` |
| `APP_PRIMARY_CONNECTION_NAME` | Name of the primary database connection | `primary` |

#### Optional Variables

| Variable | Description | Default |
|----------|-------------|---------|
| `PORT` | Port on which the plugin server runs | `8787` |
| `HOST` | Host address to bind to | `0.0.0.0` |
| `LOG_LEVEL` | Logging level (`ERROR`, `WARN`, `INFO`, `DEBUG`) | `INFO` |
| `NODE_ENV` | Node environment | `development` |

### Database Connection Setup

Configure multiple connections in your data connector:

```yaml
# In your connector's configuration.json
{
  "connection": {
    "primary": {
      "uri": "postgresql://user:pass@primary-db:5432/mydb"
    },
    "replica1": {
      "uri": "postgresql://user:pass@replica1-db:5432/mydb"
    },
    "replica2": {
      "uri": "postgresql://user:pass@replica2-db:5432/mydb"
    }
  }
}
```

## Usage

```graphql
# Queries → replicas (round-robin)
query { authors { id name } }

# Mutations → primary
mutation { insert_authors(objects: {name: "John"}) { id } }

# Read-after-write → primary (set header: x-hasura-query-read-no-stale: 1)
query { authors { id name } }
```

## Health Checks

- `GET /health` → `{"status": "healthy"}`
- `GET /ping` → `{"status": "ok"}`

## Additional Configuration

**Logging:** Set `LOG_LEVEL` to `ERROR`, `WARN`, `INFO` (default), or `DEBUG`.

**OpenTelemetry:** Tracing is supported. Configure endpoint in `src/config.js` if needed.

## Implementation Steps

### 1. Set Up Database Replication

Configure PostgreSQL replication (or your database's equivalent):

```sql
-- On primary database
CREATE ROLE replicator WITH REPLICATION LOGIN PASSWORD 'password';

-- Configure postgresql.conf
wal_level = replica
max_wal_senders = 3
```

On replica servers, configure streaming replication to follow the primary.

### 2. Configure Data Connector

Add multiple connections to your connector's `configuration.json`:

```json
{
  "connections": {
    "primary": {
      "uri": { "variable": "PRIMARY_DATABASE_URL" }
    },
    "replica1": {
      "uri": { "variable": "REPLICA1_DATABASE_URL" }
    },
    "replica2": {
      "uri": { "variable": "REPLICA2_DATABASE_URL" }
    }
  }
}
```

### 3. Deploy the Plugin

```bash
docker run -d -p 8787:8787 \
  -e APP_PRE_NDC_WEBHOOK_TOKEN=$(openssl rand -base64 32) \
  ghcr.io/hasura/engine-plugin-dynamic-connection:latest
```

### 4. Configure Hasura DDN

Add the plugin hook to your metadata (see Quick Start section above).

Set environment variables in your `.env`:

```bash
APP_PRE_NDC_WEBHOOK_URL=http://plugin:8787/pre/ndc
APP_PRE_NDC_WEBHOOK_TOKEN=<same-token-from-step-3>
APP_PRIMARY_CONNECTION_NAME=primary
APP_REPLICA_CONNECTION_NAMES=replica1,replica2
```

### 5. Deploy and Test

```bash
ddn supergraph build local
ddn run docker-start

# Test query (should hit replica)
curl -X POST http://localhost:3000/graphql \
  -d '{"query": "{ authors { id } }"}'

# Test mutation (should hit primary)
curl -X POST http://localhost:3000/graphql \
  -d '{"query": "mutation { insert_authors(objects: {name: \"test\"}) { id } }"}'

# Check plugin logs
docker logs <plugin-container-id>
```

## Development

```bash
npm install
npm run dev      # Start with hot reload
npm run lint     # Check code style
```

## Deployment

**Docker:**
```bash
docker build -t your-registry/dynamic-connection-plugin .
docker push your-registry/dynamic-connection-plugin
```

**Kubernetes:** Use health checks on `/health` endpoint with liveness/readiness probes.

## Notes

- Round-robin state is in-memory (resets on restart)
- For multi-instance deployments, consider using Redis for shared state
- Use strong tokens and HTTPS in production
- Connection names must match your data connector configuration

## Troubleshooting

**401/400 Unauthorized:** Check `APP_PRE_NDC_WEBHOOK_TOKEN` matches in both plugin and Hasura DDN config.

**Queries not distributed:** Verify `APP_REPLICA_CONNECTION_NAMES` is set correctly and check plugin logs.

**Connection not found:** Ensure connection names match exactly between plugin config and data connector.

## License

MIT License

