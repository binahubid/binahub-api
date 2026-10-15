import { createServerSupabase } from "./supabase";
import { aiRoutingPolicySchema, defaultRoutingPolicy, type AIRoutingPolicy } from "./ai-routing-policy";

type SettingsDb = ReturnType<typeof createServerSupabase>;
export async function readAIProviderSettings(db: SettingsDb = createServerSupabase()) {
  const { data, error } = await db.from("ai_provider_settings")
    .select("primary_provider,enabled_providers,version,updated_at").eq("id", true).maybeSingle();
  if (error) {
    // A staged deployment before SQL 68 retains its old routing. Other database
    // failures must not bypass a saved OFF switch by reverting to environment defaults.
    if (error.code === "42P01" || error.code === "PGRST205") {
      return { policy: null, version: 0, updatedAt: null, setupRequired: true };
    }
    throw new Error("AI_SETTINGS_UNAVAILABLE");
  }
  const policy = data?.primary_provider ? aiRoutingPolicySchema.parse({
    primaryProvider: data.primary_provider, enabledProviders: data.enabled_providers,
  }) : null;
  return { policy, version: data?.version || 0, updatedAt: data?.updated_at || null, setupRequired: !data };
}

export async function loadAIRoutingPolicy(): Promise<AIRoutingPolicy | null> {
  return (await readAIProviderSettings()).policy;
}

export function effectiveAIRoutingPolicy(policy: AIRoutingPolicy | null) {
  return policy || defaultRoutingPolicy();
}
