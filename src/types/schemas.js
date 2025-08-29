import Joi from "joi";

// Joi schemas for validation
export const sessionVariablesSchema = Joi.object().pattern(Joi.string(), Joi.string());

export const sessionSchema = Joi.object({
  role: Joi.string().required(),
  variables: sessionVariablesSchema.required()
});

export const ndcRequestSchema = Joi.object({
  request_arguments: Joi.object().pattern(Joi.string(), Joi.any()).optional()
}).unknown(true); // Allow additional properties

export const webhookRequestSchema = Joi.object({
  session: sessionSchema.required(),
  ndcRequest: ndcRequestSchema.required(),
  dataConnectorName: Joi.string().required(),
  operationType: Joi.string().valid("query", "queryExplain", "mutation", "mutationExplain").required(),
  ndcVersion: Joi.string().required()
});
