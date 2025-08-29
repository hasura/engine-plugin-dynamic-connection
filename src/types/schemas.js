import Joi from "joi";

// Joi schemas for validation
export const sessionVariablesSchema = Joi.object().pattern(Joi.string(), Joi.any());

export const sessionSchema = Joi.object({
  role: Joi.string().required(),
  variables: sessionVariablesSchema.required()
});

export const ndcRequestSchema = Joi.object({
  collection: Joi.string().optional(),
  query: Joi.object().optional(),
  arguments: Joi.object().optional(),
  collection_relationships: Joi.object().optional(),
  request_arguments: Joi.object().pattern(Joi.string(), Joi.any()).optional()
}).unknown(true); // Allow additional properties

export const dataConnectorNameSchema = Joi.object({
  subgraph: Joi.string().required(),
  name: Joi.string().required()
});

export const webhookRequestSchema = Joi.object({
  session: sessionSchema.required(),
  ndcRequest: ndcRequestSchema.required(),
  dataConnectorName: dataConnectorNameSchema.required(),
  operationType: Joi.string().valid("query", "queryExplain", "mutation", "mutationExplain").required(),
  ndcVersion: Joi.string().required()
});
