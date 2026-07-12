"use client";
import { useEffect, useState } from "react";
import { useT } from "@/lib/i18n/context";
import CategoriesEditor from "./CategoriesEditor";
import BillingSection from "./BillingSection";
import MergesManager from "./MergesManager";
import MarkedValidManager from "./MarkedValidManager";
import CategoryOverridesManager from "./CategoryOverridesManager";
import LanguageSwitcher from "./LanguageSwitcher";
import LogoutButton from "./LogoutButton";

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
      {/* Language + logout relocated here from the nav so the mobile bottom bar stays exactly 5 tabs. */}
      <div className="row wrap" style={{ justifyContent: "space-between", alignItems: "center", gap: 12, marginBottom: 22 }}>
        <h1 style={{ margin: 0 }}>{t("customizations.title")}</h1>
        <div className="row" style={{ gap: 8, alignItems: "center" }}>
          <LanguageSwitcher />
          <LogoutButton />
        </div>
      </div>

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
