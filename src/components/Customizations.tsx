"use client";
import { useEffect, useState } from "react";
import { useT } from "@/lib/i18n/context";
import CategoriesEditor from "./CategoriesEditor";
import BillingSection from "./BillingSection";
import MergesManager from "./MergesManager";
import MarkedValidManager from "./MarkedValidManager";
import CategoryOverridesManager from "./CategoryOverridesManager";

// Customizations shell: subtab nav (categories / merges / billing). Vendors moved
// to /vendors; the old Category Mappings tab was removed — vendors now solely
// determine a transaction's category (a seeded catch-all vendor covers the Plaid
// categories the mapping used to). Initial tab honors the URL hash so Stripe's
// portal return_url (#billing) lands on the right tab.
type Tab = "categories" | "merges" | "markedValid" | "overrides" | "billing";
const TABS: Tab[] = ["categories", "merges", "markedValid", "overrides", "billing"];

export default function Customizations() {
  const t = useT();
  const [tab, setTab] = useState<Tab>("categories");

  // Hash → tab after mount (avoids SSR hydration mismatch on window.location).
  useEffect(() => {
    const h = window.location.hash.slice(1);
    if ((TABS as string[]).includes(h)) setTab(h as Tab);
  }, []);

  return (
    <div>
      <h1>{t("customizations.title")}</h1>

      <div className="row wrap" style={{ gap: 8, marginBottom: 28 }} role="tablist">
        {TABS.map((id) => (
          <button
            key={id}
            role="tab"
            aria-selected={tab === id}
            className={`btn btn-sm${tab === id ? "" : " btn-ghost"}`}
            onClick={() => setTab(id)}
          >
            {t(`cust.nav.${id}`)}
          </button>
        ))}
      </div>

      {tab === "categories" && <CategoriesEditor />}
      {tab === "merges" && <MergesManager />}
      {tab === "markedValid" && <MarkedValidManager />}
      {tab === "overrides" && <CategoryOverridesManager />}
      {tab === "billing" && <BillingSection />}
    </div>
  );
}
