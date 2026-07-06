"use client";
import React, { useEffect, useState } from "react";
import { useT } from "@/lib/i18n/context";
import { VendorIcon } from "./VendorIcon";
import { RowSummary, Chip, type AnyCondition } from "./vendorSummary";

type CatalogEntry = {
  slug: string;
  name: string;
  link: string | null;
  categoryName: string | null;
  matchConditions: AnyCondition[];
  categoryRules: AnyCondition[];
};

// Catalog browser (F10, FR2): search F4's catalog, preview an entry's rows /
// suggested categories / icon, and Instantiate → a one-time editable copy appended
// at lowest priority. Reports back how many transactions the copy claimed.
export default function CatalogBrowser({
  onInstantiated,
  onClose,
}: {
  onInstantiated: (name: string, claimed: number) => void;
  onClose: () => void;
}) {
  const t = useT();
  const [q, setQ] = useState("");
  const [entries, setEntries] = useState<CatalogEntry[] | null>(null);
  const [selected, setSelected] = useState<CatalogEntry | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  // Debounced search against /api/catalog.
  useEffect(() => {
    const id = setTimeout(async () => {
      const res = await fetch(`/api/catalog?q=${encodeURIComponent(q)}`);
      if (res.ok) setEntries((await res.json()).entries);
    }, 200);
    return () => clearTimeout(id);
  }, [q]);

  async function instantiate(entry: CatalogEntry) {
    setBusy(entry.slug);
    setError(null);
    const res = await fetch("/api/catalog/instantiate", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ slug: entry.slug }),
    });
    setBusy(null);
    const data = await res.json().catch(() => ({}));
    if (!res.ok) return setError(data.error ?? t("common.genericError"));
    onInstantiated(data.vendor?.name ?? entry.name, data.claimed ?? 0);
    setSelected(null);
  }

  return (
    <div className="card" style={{ borderColor: "var(--primary)" }}>
      <div className="row" style={{ justifyContent: "space-between", marginBottom: 12 }}>
        <div className="card-header" style={{ margin: 0 }}>{t("cust.catalog.title")}</div>
        <button className="btn btn-sm btn-ghost" onClick={onClose}>{t("common.cancel")}</button>
      </div>
      <p className="muted" style={{ marginTop: 0 }}>{t("cust.catalog.help")}</p>

      <input
        placeholder={t("cust.catalog.search")}
        value={q}
        onChange={(e) => setQ(e.target.value)}
        style={{ marginBottom: 14 }}
      />

      {error && <div className="error">{error}</div>}

      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(200px, 1fr))", gap: 10 }}>
        {entries?.map((e) => (
          <button
            key={e.slug}
            type="button"
            className="card"
            style={{
              margin: 0,
              padding: 12,
              textAlign: "left",
              cursor: "pointer",
              display: "flex",
              alignItems: "center",
              gap: 10,
              borderColor: selected?.slug === e.slug ? "var(--primary)" : "var(--border)",
            }}
            onClick={() => setSelected(e)}
          >
            <VendorIcon name={e.name} size={30} />
            <span style={{ fontWeight: 600 }}>{e.name}</span>
          </button>
        ))}
        {entries?.length === 0 && <p className="muted">{t("cust.catalog.empty")}</p>}
        {!entries && <p className="muted">{t("common.loading")}</p>}
      </div>

      {/* Preview + instantiate */}
      {selected && (
        <div className="card" style={{ marginTop: 16, background: "var(--bg-3)" }}>
          <div className="row" style={{ gap: 10, marginBottom: 6 }}>
            <VendorIcon name={selected.name} size={34} />
            <strong style={{ fontSize: 16 }}>{selected.name}</strong>
            {selected.categoryName && <Chip tone="cat">{selected.categoryName}</Chip>}
          </div>
          <p className="muted" style={{ fontSize: 12, margin: "4px 0 8px" }}>{t("cust.catalog.previewRows")}</p>
          {[...selected.matchConditions, ...selected.categoryRules].map((c, i) => (
            <RowSummary key={i} condition={c} />
          ))}
          <div className="row" style={{ gap: 8, marginTop: 12 }}>
            <button className="btn btn-primary" disabled={busy === selected.slug} onClick={() => instantiate(selected)}>
              {busy === selected.slug ? t("cust.catalog.instantiating") : t("cust.catalog.instantiate")}
            </button>
            <button className="btn btn-ghost" onClick={() => setSelected(null)}>{t("common.cancel")}</button>
          </div>
        </div>
      )}
    </div>
  );
}
