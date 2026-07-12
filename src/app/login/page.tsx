import type { Metadata } from "next";
import AuthForm from "@/components/AuthForm";
import { socialConfig } from "@/lib/social";

// OAuth config is Vault-injected at runtime; never prerender the build-time (dormant) state.
export const dynamic = "force-dynamic";

export const metadata: Metadata = {
  title: "Sign in",
  description: "Sign in to PBudget to view your reconciled monthly budget ledger.",
  alternates: { canonical: "/login" },
};

export default function LoginPage() {
  return <AuthForm mode="login" social={socialConfig()} />;
}
