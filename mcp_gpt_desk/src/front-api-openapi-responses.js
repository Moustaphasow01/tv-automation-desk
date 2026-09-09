/** Shared OpenAPI response descriptions. No runtime authorization or market logic. */
export const jsonContent = (schema) => ({
  "application/json": { schema },
});

export const cachedReadResponse = (schemaRef, description = "Successful response") => ({
  description,
  headers: {
    ETag: { $ref: "#/components/headers/ETag" },
    "Cache-Control": { $ref: "#/components/headers/CacheControl" },
  },
  content: jsonContent({ $ref: schemaRef }),
});

export const errorResponses = {
  "400": { description: "Invalid path or query", content: jsonContent({ $ref: "#/components/schemas/Error" }) },
  "401": { description: "Authentication failed", content: jsonContent({ $ref: "#/components/schemas/Error" }) },
  "403": { description: "Operator scope or role forbidden", content: jsonContent({ $ref: "#/components/schemas/Error" }) },
  "404": { description: "Scoped resource not found", content: jsonContent({ $ref: "#/components/schemas/Error" }) },
  "500": { description: "Backend read failed", content: jsonContent({ $ref: "#/components/schemas/Error" }) },
};
