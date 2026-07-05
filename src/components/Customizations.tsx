"use client";
import { useState } from "react";
import { useT } from "@/lib/i18n/context";
import CategoriesEditor from "./CategoriesEditor";
import CategoryMappings from "./CategoryMappings";
import VendorBuilder from "./VendorBuilder";

// F9 customizations shell: sectioned page with anchor nav. Sections are disjoint
// slots — F10 replaces the Vendors placeholder with its builder, F11 the Billing
// placeholder. A category rename cascades server-side to mapping rows, so bumping
// `mapKey` remounts the mappings section to pull the cascaded names.
function Section({ id, title, children }: { id: string; title: string; children: React.ReactNode }) {
  return (
    <section id={id} style={{ marginBottom: 44, scrollMarginTop: 16 }}>
      <h2 style={{ fontSize: 20, margin: "0 0 12px" }}>{title}</h2>
      {children}
    </section>
  );
}

export default function Customizations() {
  const t = useT();
  const [mapKey, setMapKey] = useState(0);

  return (
    <div>
      <h1>{t("customizations.title")}</h1>

      <div className="row wrap" style={{ gap: 18, marginBottom: 28 }}>
        <a href="#categories">{t("cust.nav.categories")}</a>
        <a href="#mappings">{t("cust.nav.mappings")}</a>
        <a href="#vendors">{t("cust.nav.vendors")}</a>
        <a href="#billing">{t("cust.nav.billing")}</a>
      </div>

      <Section id="categories" title={t("cust.nav.categories")}>
        <CategoriesEditor onChanged={() => setMapKey((k) => k + 1)} />
      </Section>

      <Section id="mappings" title={t("cust.nav.mappings")}>
        <CategoryMappings key={mapKey} embedded />
      </Section>

      <Section id="vendors" title={t("cust.nav.vendors")}>
        <VendorBuilder />
      </Section>

      <Section id="billing" title={t("cust.nav.billing")}>
        {/* F11: replace this placeholder with the billing section. */}
        <p className="muted">{t("cust.billing.placeholder")}</p>
      </Section>
    </div>
  );
}
