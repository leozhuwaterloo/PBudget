"use client";
import { useEffect, useState } from "react";
import { useT } from "@/lib/i18n/context";
import CategoriesEditor from "./CategoriesEditor";
import CategoryMappings from "./CategoryMappings";
import BillingSection from "./BillingSection";

// F9 customizations shell: subtab nav (categories / mappings / billing). Vendors
// now lives on its own /vendors page. A category rename cascades server-side to
// mapping rows, so bumping `mapKey` remounts the mappings section to pull the
// cascaded names. Initial tab honors the URL hash so Stripe's portal return_url
// (#billing) lands on the right tab.
type Tab = "categories" | "mappings" | "billing";
const TABS: Tab[] = ["categories", "mappings", "billing"];

export default function Customizations() {
  const t = useT();
  const [mapKey, setMapKey] = useState(0);
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

      {tab === "categories" && <CategoriesEditor onChanged={() => setMapKey((k) => k + 1)} />}
      {tab === "mappings" && <CategoryMappings key={mapKey} embedded />}
      {tab === "billing" && <BillingSection />}
    </div>
  );
}
