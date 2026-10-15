import { z } from "zod";

export const AI_PROVIDERS = ["lapakvip", "codecraft", "openrouter"] as const;
export type AIProviderId = typeof AI_PROVIDERS[number];
export const aiRoutingPolicySchema = z.object({
  primaryProvider: z.enum(AI_PROVIDERS),
  enabledProviders: z.array(z.enum(AI_PROVIDERS)).min(1).max(3),
}).strict().refine((value) => new Set(value.enabledProviders).size === value.enabledProviders.length
  && value.enabledProviders.includes(value.primaryProvider), {
  message: "Provider utama harus aktif dan setiap provider hanya boleh dipilih sekali.",
});
export type AIRoutingPolicy = z.infer<typeof aiRoutingPolicySchema>;

export function providerConfigured(provider: AIProviderId, environment: NodeJS.ProcessEnv = process.env) {
  const keys = { lapakvip: "LAPAKVIP_API_KEY", codecraft: "CODECRAFT_API_KEY", openrouter: "OPENROUTER_API_KEY" };
  return Boolean(environment[keys[provider]]?.trim());
}

// Until the first admin save, preserve the established deployment routing.
export function defaultRoutingPolicy(environment: NodeJS.ProcessEnv = process.env): AIRoutingPolicy {
  const primaryProvider = providerConfigured("lapakvip", environment) ? "lapakvip"
    : providerConfigured("codecraft", environment) ? "codecraft" : "openrouter";
  const enabledProviders = AI_PROVIDERS.filter((provider) => providerConfigured(provider, environment)
    && (provider !== "codecraft" || primaryProvider === "codecraft"));
  return { primaryProvider, enabledProviders };
}

export function orderedProviders(policy: AIRoutingPolicy) {
  const validated = aiRoutingPolicySchema.parse(policy);
  return [validated.primaryProvider, ...AI_PROVIDERS.filter((provider) => provider !== validated.primaryProvider
    && validated.enabledProviders.includes(provider))];
}
