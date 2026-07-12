"use client";
import React, { useEffect, useState } from "react";
import { useT } from "@/lib/i18n/context";
import { VendorIcon } from "./VendorIcon";
import { RowSummary, Chip, type AnyCondition } from "./vendorSummary";

type CatalogEntry = {
  id: string; // source vendor id (what instantiate adopts)
  ownerId: string;
  isOwn: boolean; // owned by the requester → shown for confirmation, not adoptable
  name: string;
  link: string | null;
  icon: string | null;
  categoryName: string | null;
  matchConditions: AnyCondition[];
  categoryRules: AnyCondition[];
};

// A cuid is long; show a short handle (first6…last4) so ids stay readable.
function shortId(id: string): string {
  return id.length > 12 ? `${id.slice(0, 6)}…${id.slice(-4)}` : id;
}

// Community catalog (FR2, rebuilt): browse vendor rules shared by other users + all
// of Admin's, filter by name or owner id, preview one, then ADOPT it as a linked
// snapshot (re-syncable) or an independent clone. Reports how many txns it claimed.
export default function CatalogBrowser({
  onInstantiated,
  onClose,
}: {
  onInstantiated: (name: string, claimed: number) => void;
  onClose: () => void;
}) {
  const t = useT();
  const [q, setQ] = useState("");
  const [userId, setUserId] = useState(""); // owner-id filter
  const [entries, setEntries] = useState<CatalogEntry[] | null>(null);
  const [adminId, setAdminId] = useState<string | null>(null);
  const [selected, setSelected] = useState<CatalogEntry | null>(null);
  const [busy, setBusy] = useState<string | null>(null); // `${id}:${mode}`
  const [error, setError] = useState<string | null>(null);

  // Debounced browse against /api/catalog (name + owner-id filters).
  useEffect(() => {
    const id = setTimeout(async () => {
      const res = await fetch(
        `/api/catalog?q=${encodeURIComponent(q)}&userId=${encodeURIComponent(userId)}`
      );
      if (res.ok) {
        const data = await res.json();
        setEntries(data.entries);
        setAdminId(data.adminUserId ?? null);
      }
    }, 200);
    return () => clearTimeout(id);
  }, [q, userId]);

  const owner = (e: CatalogEntry) =>
    e.isOwn
      ? t("cust.catalog.byYou")
      : e.ownerId === adminId
        ? t("cust.catalog.byAdmin")
        : t("cust.catalog.byUser", { id: shortId(e.ownerId) });

  async function adopt(entry: CatalogEntry, mode: "clone" | "link") {
    setBusy(`${entry.id}:${mode}`);
    setError(null);
    const res = await fetch("/api/catalog/instantiate", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ vendorId: entry.id, mode }),
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

      <div className="row" style={{ gap: 8, marginBottom: 10, flexWrap: "wrap" }}>
        <input placeholder={t("cust.catalog.search")} value={q} onChange={(e) => setQ(e.target.value)} style={{ flex: 1, minWidth: 180 }} />
        <input placeholder={t("cust.catalog.filterUser")} value={userId} onChange={(e) => setUserId(e.target.value)} style={{ flex: 1, minWidth: 180 }} />
      </div>
      {adminId && (
        <div className="row" style={{ gap: 8, marginBottom: 14, alignItems: "center", flexWrap: "wrap" }}>
          <button type="button" className="btn btn-sm" disabled={userId === adminId} onClick={() => setUserId(adminId)}>
            {t("cust.catalog.adminRules")}
          </button>
          {userId && (
            <button type="button" className="btn btn-sm btn-ghost" onClick={() => setUserId("")}>
              {t("cust.catalog.clearFilter")}
            </button>
          )}
        </div>
      )}

      {error && <div className="error">{error}</div>}

      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(200px, 1fr))", gap: 10 }}>
        {entries?.map((e) => (
          <button
            key={e.id}
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
              borderColor: selected?.id === e.id ? "var(--primary)" : "var(--border)",
            }}
            onClick={() => setSelected(e)}
          >
            <VendorIcon name={e.name} icon={e.icon} size={30} clickable={false} />
            <span style={{ minWidth: 0 }}>
              <span style={{ fontWeight: 600, display: "block", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{e.name}</span>
              <span className="muted" style={{ fontSize: 11 }}>{owner(e)}</span>
            </span>
          </button>
        ))}
        {entries?.length === 0 && <p className="muted">{t("cust.catalog.empty")}</p>}
        {!entries && <p className="muted">{t("common.loading")}</p>}
      </div>

      {/* Preview + adopt */}
      {selected && (
        <div className="card" style={{ marginTop: 16, background: "var(--bg-3)" }}>
          <div className="row" style={{ gap: 10, marginBottom: 6 }}>
            <VendorIcon name={selected.name} icon={selected.icon} link={selected.link} size={34} />
            <strong style={{ fontSize: 16 }}>{selected.name}</strong>
            {selected.categoryName && <Chip tone="cat">{selected.categoryName}</Chip>}
          </div>
          <p className="muted" style={{ fontSize: 12, margin: "4px 0 2px" }}>{owner(selected)}</p>
          <p className="muted" style={{ fontSize: 12, margin: "4px 0 8px" }}>{t("cust.catalog.previewRows")}</p>
          {[...selected.matchConditions, ...selected.categoryRules].map((c, i) => (
            <RowSummary key={i} condition={c} />
          ))}
          {selected.isOwn ? (
            <div className="row" style={{ gap: 8, marginTop: 12, flexWrap: "wrap", alignItems: "center" }}>
              <p className="muted" style={{ fontSize: 12, margin: 0 }}>{t("cust.catalog.ownRule")}</p>
              <button className="btn btn-ghost" onClick={() => setSelected(null)}>{t("common.cancel")}</button>
            </div>
          ) : (
            <>
              <div className="row" style={{ gap: 8, marginTop: 12, flexWrap: "wrap" }}>
                <button className="btn btn-primary" disabled={!!busy} onClick={() => adopt(selected, "link")}>
                  {busy === `${selected.id}:link` ? t("cust.catalog.adopting") : t("cust.catalog.useLinked")}
                </button>
                <button className="btn" disabled={!!busy} onClick={() => adopt(selected, "clone")}>
                  {busy === `${selected.id}:clone` ? t("cust.catalog.adopting") : t("cust.catalog.clone")}
                </button>
                <button className="btn btn-ghost" onClick={() => setSelected(null)}>{t("common.cancel")}</button>
              </div>
              <p className="muted" style={{ fontSize: 11, marginTop: 8 }}>{t("cust.catalog.modeHelp")}</p>
            </>
          )}
        </div>
      )}
    </div>
  );
}
