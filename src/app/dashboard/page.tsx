import { redirect } from "next/navigation";
import { requireUser } from "@/lib/auth";
import { dashboardData } from "@/lib/dashboard";
import Dashboard from "@/components/Dashboard";

export const dynamic = "force-dynamic";

// Graphs-only Dashboard (FR7). Connect/sync moved to /accounts (F8); the funnel
// queue lives on /review (F12). We just gate, compute the aggregate for the
// current month for first paint, and hand off to the client widgets.
export default async function DashboardPage() {
  const user = await requireUser();
  if (!user.emailVerified) redirect("/verify");

  const initial = await dashboardData(user.id);
  return <Dashboard initial={initial} />;
}
