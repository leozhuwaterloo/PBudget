import { redirect } from "next/navigation";
import { requireUser } from "@/lib/auth";
import CategoryMappings from "@/components/CategoryMappings";

export const dynamic = "force-dynamic";

// FR6 category-mapping settings. The client component owns fetch + save against
// GET/PUT /api/categories/mapping (single source of truth for the primary list),
// so this page just gates the session like the other pages.
export default async function CategoriesSettingsPage() {
  const user = await requireUser();
  if (!user.emailVerified) redirect("/verify");
  return <CategoryMappings />;
}
