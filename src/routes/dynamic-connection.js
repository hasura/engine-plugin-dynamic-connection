import { Config } from "../config.js";
import { respond, userError, serverError } from "../server/response.js";
import { webhookRequestSchema } from "../types/schemas.js";
import logger from "../logger.js";

// Global counter for round-robin selection
// Note we are relying on server state here. A more robust implementation would use something like redis
let currentReplicaIndex = 0;

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

    // Route mutations to primary database
    if (requestData.operationType === "mutation" || 
        requestData.operationType === "mutationExplain" || 
        requestData.session.variables["x-hasura-query-read-no-stale"] === "true") {
      
      selectedConnection = Config.primary_connection_name;
      routingReason = "mutation_or_no_stale";
      
      logger.info("Routing to primary database", {
        operationType: requestData.operationType,
        reason: routingReason,
        connection: selectedConnection
      });
    } else {
      // Route queries to read replicas using round-robin
      selectedConnection = Config.replica_connection_names[currentReplicaIndex];
      
      // Increment the index for the next request
      currentReplicaIndex = (currentReplicaIndex + 1) % Config.replica_connection_names.length;
      
      routingReason = "round_robin_replica";
      
      logger.info("Routing to read replica", {
        operationType: requestData.operationType,
        reason: routingReason,
        connection: selectedConnection,
        replicaIndex: currentReplicaIndex - 1
      });
    }

    // Set the connection name in the request arguments
    requestData.ndcRequest.request_arguments["connection_name"] = selectedConnection;

    return respond({
      attributes: {
        connection_name: selectedConnection,
        routing_reason: routingReason,
        operation_type: requestData.operationType,
        replica_index: routingReason === "round_robin_replica" ? currentReplicaIndex - 1 : undefined
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
