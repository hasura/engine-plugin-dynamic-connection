import { Config } from "../config.js";
import { respond, userError, serverError } from "../server/response.js";
import { webhookRequestSchema } from "../types/schemas.js";
import logger from "../logger.js";

// Global counter for round-robin selection for each project (jdbc-postgres)
// Note we are relying on server state here. A more robust implementation would use something like redis
let currentReplicaIndex = {};

// Global counter for round-robin selection (ndc-postgres - simple global counter)
let ndcReplicaIndex = 0;

// Maximum number of project IDs to track (prevents memory leak)
const MAX_PROJECT_IDS = 1000;

// Supported connector types
const CONNECTOR_TYPE_NDC_POSTGRES = "ndc-postgres";
const CONNECTOR_TYPE_JDBC_POSTGRES = "jdbc-postgres";

/**
 * Cleanup old project IDs if we exceed the maximum
 * Uses a simple strategy: clear all when limit is reached
 * A more sophisticated approach would use LRU cache
 */
function cleanupReplicaIndex() {
  const projectIds = Object.keys(currentReplicaIndex);
  if (projectIds.length >= MAX_PROJECT_IDS) {
    currentReplicaIndex = {};
  }
}

/**
 * Helper function to check if a value is truthy
 * Handles various representations of true: 1, "1", true, "true"
 */
function isTruthy(value) {
  return value === 1 || value === "1" || value === true || value === "true";
}

/**
 * Helper function to sanitize JDBC URLs for logging
 * Replaces password values with *** to prevent credential leakage
 */
function sanitizeJdbcUrl(url) {
  if (!url || typeof url !== 'string') {
    return '***';
  }
  try {
    // Replace password parameter value with ***
    return url.replace(/password=([^&\s]+)/gi, 'password=***');
  } catch (error) {
    return '***';
  }
}

/**
 * Dynamic connection routing handler for pre-NDC requests
 * Routes mutations to primary database and queries to read replicas using round-robin
 */
export default async function dynamicConnectionHandler(req) {
  try {
    logger.debug("Processing dynamic connection request", {
      method: req.method,
      path: req.path,
      hasBody: !!req.body
    });

    const token = Config.headers["hasura-m-auth"];

    if(req.header("hasura-m-auth") !== token) {
      logger.warn("Unauthorized request", {
        "endpoint": "/pre/ndc",
        "reason": "invalid_auth_header"
      });

      return userError({
        attributes: { unauthorized: true },
        response: {
          error: "Unauthorized",
          message: "Invalid auth header"
        },
        message: "Unauthorized request"
      });
    }

    // Determine connector type from header (default to ndc-postgres for backward compatibility)
    const connectorType = req.header("hasura-connector-type") || CONNECTOR_TYPE_NDC_POSTGRES;

    logger.debug("Connector type detected", {
      connectorType,
      isJdbc: connectorType === CONNECTOR_TYPE_JDBC_POSTGRES
    });

    // Branch to appropriate handler based on connector type
    if (connectorType === CONNECTOR_TYPE_JDBC_POSTGRES) {
      return handleJdbcPostgres(req);
    } else {
      return handleNdcPostgres(req);
    }

  } catch (error) {
    // Log error without exposing stack trace in production
    const errorContext = {
      error: error.message
    };
    // Only include stack trace in development/debug mode
    if (process.env.NODE_ENV !== 'production') {
      errorContext.stack = error.stack;
    }
    logger.error("Error in dynamic connection handler", errorContext);

    return serverError({
      attributes: { internal_error: true },
      response: {
        error: "Internal server error",
        message: error.message
      },
      message: "Dynamic connection handler failed"
    });
  }
}

/**
 * Handler for ndc-postgres connector (original logic)
 * Uses connection_name in request_arguments
 * Uses header-based connection names (simpler, no JDBC URL mapping)
 */
async function handleNdcPostgres(req) {
  // Get the primary connection name and replica connection names from header
  const primaryConnectionNameHeader = Config.primary_connection_name_header_name || "hasura-primary-connection-name";
  const replicaConnectionNamesHeader = Config.replica_connection_names_header_name || "hasura-replica-connection-names";
  const primaryConnectionName = req.header(primaryConnectionNameHeader);
  const replicaConnectionNames = req.header(replicaConnectionNamesHeader);

  if (!primaryConnectionName) {
    logger.error("Primary connection name not found in header", {
      headerName: primaryConnectionNameHeader,
      connectorType: CONNECTOR_TYPE_NDC_POSTGRES
    });
    return serverError({
      attributes: { primary_connection_name_not_found: true },
      response: {
        error: "Internal server error",
        message: "Primary connection name not found in header"
      },
      message: "Primary connection name not found in header"
    });
  }

  if (!replicaConnectionNames) {
    logger.error("Replica connection names not found in header", {
      headerName: replicaConnectionNamesHeader,
      connectorType: CONNECTOR_TYPE_NDC_POSTGRES
    });
    return serverError({
      attributes: { replica_connection_names_not_found: true },
      response: {
        error: "Internal server error",
        message: "Replica connection names not found in header"
      },
      message: "Replica connection names not found in header"
    });
  }

  // Parse the replica connection names as a comma-separated list
  const replicaConnectionNamesList = replicaConnectionNames
    .split(",")
    .map(name => name.trim())
    .filter(name => name.length > 0);

  if (replicaConnectionNamesList.length === 0) {
    logger.error("No valid replica connection names found after parsing", {
      originalValue: replicaConnectionNames,
      connectorType: CONNECTOR_TYPE_NDC_POSTGRES
    });
    return serverError({
      attributes: { no_valid_replicas: true },
      response: {
        error: "Internal server error",
        message: "No valid replica connection names found"
      },
      message: "Replica connection names list is empty after parsing"
    });
  }

  // Validate the request body using Joi
  const { error, value: requestData } = webhookRequestSchema.validate(req.body);

  if (error) {
    logger.warn("Request validation failed", {
      validationErrors: error.details.map(detail => detail.message),
      connectorType: CONNECTOR_TYPE_NDC_POSTGRES
    });
    return userError({
      attributes: { validation_error: true },
      response: {
        error: "Invalid request format",
        details: error.details.map(detail => detail.message)
      },
      message: "Request validation failed"
    });
  }

  // Initialize request_arguments if not present
  if (!requestData.ndcRequest.request_arguments) {
    requestData.ndcRequest.request_arguments = {};
  }

  // Initialize session variables if not present
  if (!requestData.session) {
    requestData.session = { variables: {} };
  }
  if (!requestData.session.variables) {
    requestData.session.variables = {};
  }

  let selectedConnection;
  let routingReason;

  // Check for read-no-stale flag in header or session variables
  const readNoStaleHeader = isTruthy(req.header("x-hasura-query-read-no-stale"));
  const readNoStaleSession = isTruthy(requestData.session?.variables?.["x-hasura-query-read-no-stale"]);

  // Route mutations to primary database, or queries with read-no-stale flag
  if (requestData.operationType === "mutation" ||
      requestData.operationType === "mutationExplain" ||
      readNoStaleHeader ||
      readNoStaleSession) {

    selectedConnection = primaryConnectionName;
    routingReason = "mutation_or_no_stale";

    logger.info("Routing to primary database (ndc-postgres)", {
      operationType: requestData.operationType,
      reason: routingReason,
      connection: selectedConnection,
      readNoStaleHeader,
      readNoStaleSession,
      connectorType: CONNECTOR_TYPE_NDC_POSTGRES
    });
  } else {
    // Route queries to read replicas using simple global round-robin
    selectedConnection = replicaConnectionNamesList[ndcReplicaIndex];

    // Increment the index for the next request
    ndcReplicaIndex = (ndcReplicaIndex + 1) % replicaConnectionNamesList.length;

    routingReason = "round_robin_replica";

    logger.info("Routing to read replica (ndc-postgres)", {
      operationType: requestData.operationType,
      reason: routingReason,
      connection: selectedConnection,
      replicaIndex: ndcReplicaIndex === 0 ? replicaConnectionNamesList.length - 1 : ndcReplicaIndex - 1,
      connectorType: CONNECTOR_TYPE_NDC_POSTGRES
    });
  }

  // Set the connection_name in the request arguments for ndc-postgres connector
  requestData.ndcRequest.request_arguments["connection_name"] = selectedConnection;

  logger.info("Connection routing complete (ndc-postgres)", {
    selectedConnection,
    routingReason,
    operationType: requestData.operationType,
    connectorType: CONNECTOR_TYPE_NDC_POSTGRES
  });

  return respond({
    attributes: {
      connection_name: selectedConnection,
      routing_reason: routingReason,
      operation_type: requestData.operationType,
      connector_type: CONNECTOR_TYPE_NDC_POSTGRES
    },
    response: {
      ndcRequest: requestData.ndcRequest
    },
    message: `Routed to ${selectedConnection} (${routingReason})`
  });
}

/**
 * Handler for jdbc-postgres connector (new logic)
 * Uses connection_string (JDBC URL) in request_arguments
 * Uses header-based connection mapping with project ID tracking
 */
async function handleJdbcPostgres(req) {
  // Get the primary connection name and replica connection names from header
  const primaryConnectionNameHeader = Config.primary_connection_name_header_name || "hasura-primary-connection-name";
  const replicaConnectionNamesHeader = Config.replica_connection_names_header_name || "hasura-replica-connection-names";
  const primaryConnectionName = req.header(primaryConnectionNameHeader);
  const replicaConnectionNames = req.header(replicaConnectionNamesHeader);

  if (!primaryConnectionName) {
    logger.error("Primary connection name not found in header", {
      headerName: primaryConnectionNameHeader,
      connectorType: CONNECTOR_TYPE_JDBC_POSTGRES
    });
    return serverError({
      attributes: { primary_connection_name_not_found: true },
      response: {
        error: "Internal server error",
        message: "Primary connection name not found in header"
      },
      message: "Primary connection name not found in header"
    });
  }

  if (!replicaConnectionNames) {
    logger.error("Replica connection names not found in header", {
      headerName: replicaConnectionNamesHeader,
      connectorType: CONNECTOR_TYPE_JDBC_POSTGRES
    });
    return serverError({
      attributes: { replica_connection_names_not_found: true },
      response: {
        error: "Internal server error",
        message: "Replica connection names not found in header"
      },
      message: "Replica connection names not found in header"
    });
  }

  // Parse the replica connection names as a comma-separated list
  const replicaConnectionNamesList = replicaConnectionNames
    .split(",")
    .map(name => name.trim())
    .filter(name => name.length > 0);

  if (replicaConnectionNamesList.length === 0) {
    logger.error("No valid replica connection names found after parsing", {
      originalValue: replicaConnectionNames,
      connectorType: CONNECTOR_TYPE_JDBC_POSTGRES
    });
    return serverError({
      attributes: { no_valid_replicas: true },
      response: {
        error: "Internal server error",
        message: "No valid replica connection names found"
      },
      message: "Replica connection names list is empty after parsing"
    });
  }

  // Get the connection mapping from header (sent as JSON string) - REQUIRED for jdbc-postgres
  const connectionMappingHeader = req.header("hasura-connection-mapping");
  let connectionMapping = {};

  if (connectionMappingHeader) {
    try {
      connectionMapping = JSON.parse(connectionMappingHeader);
      logger.debug("Parsed connection mapping from header", {
        connectionNames: Object.keys(connectionMapping),
        primaryConnection: primaryConnectionName,
        replicaConnections: replicaConnectionNamesList,
        connectorType: CONNECTOR_TYPE_JDBC_POSTGRES
      });
    } catch (parseError) {
      logger.error("Failed to parse connection mapping JSON", {
        error: parseError.message,
        headerValue: connectionMappingHeader.substring(0, 100) + "...",
        connectorType: CONNECTOR_TYPE_JDBC_POSTGRES
      });
      return serverError({
        attributes: { connection_mapping_parse_error: true },
        response: {
          error: "Internal server error",
          message: "Failed to parse connection mapping"
        },
        message: "Connection mapping JSON parse error"
      });
    }
  } else {
    logger.error("Connection mapping header is required for jdbc-postgres", {
      connectorType: CONNECTOR_TYPE_JDBC_POSTGRES
    });
    return serverError({
      attributes: { connection_mapping_missing: true },
      response: {
        error: "Internal server error",
        message: "Connection mapping header is required for jdbc-postgres connector"
      },
      message: "Connection mapping header missing"
    });
  }

  // Get the project ID from the header (mandatory for jdbc-postgres)
  const projectIdHeader = Config.project_id_header_name || "hasura-unique-project-id";
  const projectId = req.header(projectIdHeader);
  if (!projectId) {
    logger.error("Missing required project ID header", {
      headerName: projectIdHeader,
      connectorType: CONNECTOR_TYPE_JDBC_POSTGRES
    });
    return userError({
      attributes: { missing_project_id: true },
      response: {
        error: `Missing required header: ${projectIdHeader}`,
        message: "Project ID is required for multi-project deployments"
      },
      message: "Missing required project ID header"
    });
  }

  // Validate the request body using Joi
  const { error, value: requestData } = webhookRequestSchema.validate(req.body);

  if (error) {
    logger.warn("Request validation failed", {
      validationErrors: error.details.map(detail => detail.message),
      connectorType: CONNECTOR_TYPE_JDBC_POSTGRES
    });
    return userError({
      attributes: { validation_error: true },
      response: {
        error: "Invalid request format",
        details: error.details.map(detail => detail.message)
      },
      message: "Request validation failed"
    });
  }

  // Initialize request_arguments if not present
  if (!requestData.ndcRequest.request_arguments) {
    requestData.ndcRequest.request_arguments = {};
  }

  // Initialize session variables if not present
  if (!requestData.session) {
    requestData.session = { variables: {} };
  }
  if (!requestData.session.variables) {
    requestData.session.variables = {};
  }

  let selectedConnection;
  let routingReason;
  let selectedReplicaIndex = null;

  // Check for read-no-stale flag in header or session variables (with null safety)
  const readNoStaleHeader = isTruthy(req.header("x-hasura-query-read-no-stale"));
  const readNoStaleSession = isTruthy(requestData.session?.variables?.["x-hasura-query-read-no-stale"]);

  // Route mutations to primary database, or queries with read-no-stale flag
  if (requestData.operationType === "mutation" ||
      requestData.operationType === "mutationExplain" ||
      readNoStaleHeader ||
      readNoStaleSession) {

    selectedConnection = primaryConnectionName;
    routingReason = "mutation_or_no_stale";

    logger.info("Routing to primary database (jdbc-postgres)", {
      operationType: requestData.operationType,
      reason: routingReason,
      connection: selectedConnection,
      readNoStaleHeader,
      readNoStaleSession,
      connectorType: CONNECTOR_TYPE_JDBC_POSTGRES
    });
  } else {
    // Cleanup old project IDs to prevent memory leak
    cleanupReplicaIndex();

    // Initialize or validate the index BEFORE selection
    if (!currentReplicaIndex[projectId] ||
        currentReplicaIndex[projectId] >= replicaConnectionNamesList.length) {
      currentReplicaIndex[projectId] = 0;
    }

    // Route queries to read replicas using round-robin per project
    selectedReplicaIndex = currentReplicaIndex[projectId];
    selectedConnection = replicaConnectionNamesList[selectedReplicaIndex];

    // Increment the index for the next request
    currentReplicaIndex[projectId] = (currentReplicaIndex[projectId] + 1) % replicaConnectionNamesList.length;

    routingReason = "round_robin_replica";

    logger.info("Routing to read replica (jdbc-postgres)", {
      operationType: requestData.operationType,
      reason: routingReason,
      connection: selectedConnection,
      replicaIndex: selectedReplicaIndex,
      nextIndex: currentReplicaIndex[projectId],
      projectId,
      connectorType: CONNECTOR_TYPE_JDBC_POSTGRES
    });
  }

  // Map connection name to connection string (JDBC URL)
  if (!connectionMapping[selectedConnection]) {
    logger.error("Selected connection not found in mapping", {
      selectedConnection,
      availableConnections: Object.keys(connectionMapping),
      primaryConnection: primaryConnectionName,
      replicaConnections: replicaConnectionNamesList,
      connectorType: CONNECTOR_TYPE_JDBC_POSTGRES
    });
    return serverError({
      attributes: { connection_not_in_mapping: true },
      response: {
        error: "Internal server error",
        message: `Connection '${selectedConnection}' not found in connection mapping`
      },
      message: "Connection mapping incomplete"
    });
  }

  const connectionString = connectionMapping[selectedConnection];
  logger.debug("Mapped connection name to JDBC URL", {
    connectionName: selectedConnection,
    connectionString: sanitizeJdbcUrl(connectionString),
    connectorType: CONNECTOR_TYPE_JDBC_POSTGRES
  });

  // Set the connection_string in the request arguments for jdbc-postgres connector
  requestData.ndcRequest.request_arguments["connection_string"] = connectionString;

  logger.info("Connection routing complete (jdbc-postgres)", {
    selectedConnection,
    routingReason,
    operationType: requestData.operationType,
    sanitizedConnectionString: sanitizeJdbcUrl(connectionString),
    connectorType: CONNECTOR_TYPE_JDBC_POSTGRES
  });

  return respond({
    attributes: {
      connection_name: selectedConnection,
      connection_string: sanitizeJdbcUrl(connectionString),
      routing_reason: routingReason,
      operation_type: requestData.operationType,
      replica_index: selectedReplicaIndex,
      connector_type: CONNECTOR_TYPE_JDBC_POSTGRES
    },
    response: {
      ndcRequest: requestData.ndcRequest
    },
    message: `Routed to ${selectedConnection} (${routingReason})`
  });
}
