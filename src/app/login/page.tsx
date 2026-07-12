import type { Metadata } from "next";
import AuthForm from "@/components/AuthForm";
import { socialConfig } from "@/lib/social";

export const metadata: Metadata = {
  title: "Sign in",
  description: "Sign in to PBudget to view your reconciled monthly budget ledger.",
  alternates: { canonical: "/login" },
};

export default function LoginPage() {
  return <AuthForm mode="login" social={socialConfig()} />;
}
