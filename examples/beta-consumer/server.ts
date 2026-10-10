import { createV1Handler, type CustomerPolicy } from './handler.js';

// Mount the returned handler at POST /api/bugdrop-capability/v1.
// The policy is mandatory: real session + CSRF + authorization + limits + durable binding.
export function capabilityEndpoint(
  configuration: { apiKey: string; origin: string; endpoint: string },
  policy: CustomerPolicy
) {
  return createV1Handler({ ...configuration, timeoutMs: 5000 }, policy);
}
