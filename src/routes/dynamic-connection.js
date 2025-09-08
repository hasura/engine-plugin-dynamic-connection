import { Config } from "../config.js";
import { respond, userError, serverError } from "../server/response.js";
import { webhookRequestSchema } from "../types/schemas.js";
import logger from "../logger.js";

// Global counter for round-robin selection for each project
// Note we are relying on server state here. A more robust implementation would use something like redis
let currentReplicaIndex = {};

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

    // Get the primary connection name and replica connection names from header
    // Get the header name from config or use `hasura-primary-connection-name`
    const primaryConnectionNameHeader = Config.primary_connection_name_header_name || "hasura-primary-connection-name";
    // Get the header name from config or use `hasura-replica-connection-names`
    const replicaConnectionNamesHeader = Config.replica_connection_names_header_name || "hasura-replica-connection-names";
    const primaryConnectionName = req.header(primaryConnectionNameHeader);
    const replicaConnectionNames = req.header(replicaConnectionNamesHeader);

    if (!primaryConnectionName) {
      logger.error("Primary connection name not found in header", {
        headerName: primaryConnectionNameHeader
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
        headerName: replicaConnectionNamesHeader
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
    const replicaConnectionNamesList = replicaConnectionNames.split(",");

    // Get the project ID from the header
    const projectIdHeader = Config.project_id_header_name || "hasura-unique-project-id";
    const projectId = req.header(projectIdHeader);
    if (!projectId) {
      logger.error("Project ID not found in header", {
        headerName: projectIdHeader
      });

      return serverError({
        attributes: { project_id_not_found: true },
        response: {
          error: "Internal server error",
          message: "Project ID not found in header"
        },
        message: "Project ID not found in header"
      });
    }

    // Validate the request body using Joi
    const { error, value: requestData } = webhookRequestSchema.validate(req.body);
    
    if (error) {
      logger.warn("Request validation failed", {
        validationErrors: error.details.map(detail => detail.message)
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

    let selectedConnection;
    let routingReason;

    let read_no_stale_header = false;
    if (req.header("x-hasura-query-read-no-stale") === "1" ||
        req.header("x-hasura-query-read-no-stale") === 1 ||
        req.header("x-hasura-query-read-no-stale") === true ||
        req.header("x-hasura-query-read-no-stale") === "true") {
      read_no_stale_header = true;
    }

    // Route mutations to primary database
    if (requestData.operationType === "mutation" ||
        requestData.operationType === "mutationExplain" ||
        requestData.session.variables["x-hasura-query-read-no-stale"] === 1 ||
        requestData.session.variables["x-hasura-query-read-no-stale"] === "1" ||
        requestData.session.variables["x-hasura-query-read-no-stale"] === true ||
        requestData.session.variables["x-hasura-query-read-no-stale"] === "true" ||
        read_no_stale_header
      ) {
      
      selectedConnection = primaryConnectionName;
      routingReason = "mutation_or_no_stale";
      
      logger.info("Routing to primary database", {
        operationType: requestData.operationType,
        reason: routingReason,
        connection: selectedConnection
      });
    } else {
      // Check if the project ID exists in the currentReplicaIndex, if not, add it
      if (!currentReplicaIndex[projectId]) {
        currentReplicaIndex[projectId] = 0;
      }

      // Check if the index is out of bounds for the current replica list
      if (currentReplicaIndex[projectId] >= replicaConnectionNamesList.length) {
        currentReplicaIndex[projectId] = 0;
      }

      // Route queries to read replicas using round-robin
      selectedConnection = replicaConnectionNamesList[currentReplicaIndex[projectId]];
      
      // Increment the index for the next request
      currentReplicaIndex[projectId] = (currentReplicaIndex[projectId] + 1) % replicaConnectionNamesList.length;
      
      routingReason = "round_robin_replica";
      
      logger.info("Routing to read replica", {
        operationType: requestData.operationType,
        reason: routingReason,
        connection: selectedConnection,
        replicaIndex: currentReplicaIndex[projectId] - 1
      });
    }

    // Set the connection name in the request arguments
    requestData.ndcRequest.request_arguments["connection_name"] = selectedConnection;

    return respond({
      attributes: {
        connection_name: selectedConnection,
        routing_reason: routingReason,
        operation_type: requestData.operationType,
        replica_index: routingReason === "round_robin_replica" ? currentReplicaIndex[projectId] - 1 : undefined
      },
      response: {
        ndcRequest: requestData.ndcRequest
      },
      message: `Routed to ${selectedConnection} (${routingReason})`
    });

  } catch (error) {
    logger.error("Error in dynamic connection handler", {
      error: error.message,
      stack: error.stack
    });

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
