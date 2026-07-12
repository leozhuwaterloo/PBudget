import { appleConfigured } from "@/lib/apple";
import type { SocialConfig } from "@/components/AuthForm";

// Resolve the public OAuth config from env (server-only) for the login/signup
// pages to hand to <AuthForm>. Every field is env-gated, so the social buttons
// stay hidden until the GOOGLE_*/APPLE_* vars are set. Only public identifiers
// are exposed here — never GOOGLE_CLIENT_SECRET or APPLE_PRIVATE_KEY.
export function socialConfig(): SocialConfig {
  return {
    googleEnabled: !!process.env.GOOGLE_CLIENT_ID,
    appleEnabled: appleConfigured(),
    googleWebClientId: process.env.GOOGLE_CLIENT_ID,
    googleIosClientId: process.env.GOOGLE_IOS_CLIENT_ID,
    appleServicesId: process.env.APPLE_SERVICES_ID,
  };
}
