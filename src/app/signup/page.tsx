import type { Metadata } from "next";
import AuthForm from "@/components/AuthForm";
import { socialConfig } from "@/lib/social";

export const metadata: Metadata = {
  title: "Create your ledger",
  description:
    "Create a PBudget account — link your banks through Plaid and get an automatically categorized, reconciled monthly budget. Free for the first month.",
  alternates: { canonical: "/signup" },
};

export default function SignupPage() {
  return <AuthForm mode="signup" social={socialConfig()} />;
}
