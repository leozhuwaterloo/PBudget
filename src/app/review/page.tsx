import { redirect } from "next/navigation";
import { requireUser } from "@/lib/auth";
import Review from "@/components/Review";

export const dynamic = "force-dynamic";

// The auditor loop (FR5). All data comes from the F2/F3 JSON APIs, so this page
// just session-gates and hands off to the client component.
export default async function ReviewPage() {
  const user = await requireUser();
  if (!user.emailVerified) redirect("/verify");
  return <Review />;
}
