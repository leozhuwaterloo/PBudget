"use client";
import React, { useEffect, useMemo, useState } from "react";
import { useT } from "@/lib/i18n/context";
import { VendorIcon } from "./VendorIcon";
import VendorEditor, { type Vendor, type Refs } from "./VendorEditor";
import CatalogBrowser from "./CatalogBrowser";
import TransactionBrowser from "./TransactionBrowser";
import { RowSummary, Chip } from "./vendorSummary";

// F10 vendor builder + catalog browser. Fills the Vendors slot F9 left in
// /customizations. Priority-ordered list (reorder → F3 endpoint), a full condition
// builder (create/edit → F3 CRUD), and the catalog browser (instantiate → F4).
export default function VendorBuilder() {
  const t = useT();
  const [vendors, setVendors] = useState<Vendor[] | null>(null);
  const [categories, setCategories] = useState<string[]>([]);
  const [refs, setRefs] = useState<Refs>({ accounts: [], plaidPrimaries: [], plaidDetaileds: [] });
  const [loadError, setLoadError] = useState<string | null>(null);
  const [editing, setEditing] = useState<Vendor | null | "new">(null); // null = closed, "new" = create
  const [showCatalog, setShowCatalog] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);
  const [rowError, setRowError] = useState<string | null>(null);
  const [openTxns, setOpenTxns] = useState<string | null>(null); // vendor id whose txns are shown

  async function refresh() {
    const res = await fetch("/api/vendors");
    if (!res.ok) return setLoadError(t("cust.vendors.loadFailed"));
    setVendors((await res.json()).vendors);
  }

  useEffect(() => {
    (async () => {
      const [v, c, r] = await Promise.all([
        fetch("/api/vendors"),
        fetch("/api/categories"),
        fetch("/api/vendors/refs"),
      ]);
      if (!v.ok) return setLoadError(t("cust.vendors.loadFailed"));
      setVendors((await v.json()).vendors);
      if (c.ok) setCategories((await c.json()).categories.map((x: { name: string }) => x.name));
      if (r.ok) setRefs(await r.json());
    })();
  }, []);

  const accountName = useMemo(() => {
    const m = new Map(refs.accounts.map((a) => [a.accountId, a.name]));
    return (id: string) => m.get(id) ?? id;
  }, [refs]);

  // Reorder over the priority-bearing vendors (the reorder API needs exactly them).
  const ordered = useMemo(() => (vendors ?? []).filter((v) => v.priority != null), [vendors]);

  async function move(index: number, dir: -1 | 1) {
    const next = index + dir;
    if (next < 0 || next >= ordered.length) return;
    const ids = ordered.map((v) => v.id);
    [ids[index], ids[next]] = [ids[next], ids[index]];
    setRowError(null);
    const res = await fetch("/api/vendors/reorder", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ order: ids }),
    });
    if (!res.ok) {
      const data = await res.json().catch(() => ({}));
      return setRowError(data.error ?? t("common.genericError"));
    }
    await refresh();
  }

  async function del(v: Vendor) {
    if (!window.confirm(t("cust.vendors.confirmDelete", { name: v.name }))) return;
    setRowError(null);
    const res = await fetch("/api/vendors", {
      method: "DELETE",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ id: v.id }),
    });
    if (!res.ok) {
      const data = await res.json().catch(() => ({}));
      return setRowError(data.error ?? t("common.genericError"));
    }
    await refresh();
    setNotice(t("cust.vendors.deleted", { name: v.name }));
  }

  if (!vendors) return <p className="muted">{loadError ?? t("common.loading")}</p>;

  // The editor renders in place: a new vendor at the top (by the Add button), an
  // existing one inline where its row is — so Save/Cancel returns you to that row
  // instead of jumping to the top.
  const editor = (initial: Vendor | null) => (
    <VendorEditor
      initial={initial}
      categories={categories}
      refs={refs}
      onCancel={() => setEditing(null)}
      onSaved={async () => {
        setEditing(null);
        await refresh();
      }}
    />
  );

  return (
    <div>
      <p className="muted" style={{ marginTop: 0 }}>{t("cust.vendors.help")}</p>

      <div className="row" style={{ gap: 8, marginBottom: 16 }}>
        <button className="btn btn-primary" disabled={editing === "new"} onClick={() => setEditing("new")}>{t("cust.vendors.add")}</button>
        <button className="btn" onClick={() => setShowCatalog((s) => !s)}>{t("cust.vendors.browseCatalog")}</button>
      </div>

      {editing === "new" && <div style={{ marginBottom: 16 }}>{editor(null)}</div>}

      {notice && (
        <div className="banner row" style={{ justifyContent: "space-between" }}>
          <span>{notice}</span>
          <button className="btn btn-sm btn-ghost" onClick={() => setNotice(null)}>✕</button>
        </div>
      )}
      {rowError && <div className="error">{rowError}</div>}

      {showCatalog && (
        <div style={{ marginBottom: 18 }}>
          <CatalogBrowser
            onClose={() => setShowCatalog(false)}
            onInstantiated={async (name, claimed) => {
              await refresh();
              setNotice(t("cust.vendors.instantiated", { name, count: claimed }));
            }}
          />
        </div>
      )}

      {vendors.length === 0 && <p className="muted">{t("cust.vendors.empty")}</p>}

      {vendors.map((v) => {
        // Editing this vendor? Swap its row for the editor in place.
        if (editing !== "new" && editing?.id === v.id) {
          return <div key={v.id}>{editor(editing)}</div>;
        }
        const idx = ordered.findIndex((o) => o.id === v.id);
        const canReorder = idx !== -1;
        return (
          <div key={v.id} className="card">
            <div className="row" style={{ gap: 12, alignItems: "flex-start" }}>
              {/* reorder controls */}
              {canReorder && (
                <div style={{ display: "flex", flexDirection: "column", gap: 2 }}>
                  <button className="btn btn-sm btn-ghost" style={{ padding: "2px 6px" }} disabled={idx === 0} onClick={() => move(idx, -1)} title={t("cust.vendors.moveUp")}>▲</button>
                  <button className="btn btn-sm btn-ghost" style={{ padding: "2px 6px" }} disabled={idx === ordered.length - 1} onClick={() => move(idx, 1)} title={t("cust.vendors.moveDown")}>▼</button>
                </div>
              )}
              <VendorIcon name={v.name} link={v.link} icon={v.icon} size={34} />
              <div style={{ flex: 1, minWidth: 0 }}>
                <div className="row wrap" style={{ gap: 10 }}>
                  <strong style={{ fontSize: 15 }}>{v.name}</strong>
                  {v.categoryName && <Chip tone="cat">{t("cust.vendors.defaultChip", { name: v.categoryName })}</Chip>}
                </div>
                <div style={{ marginTop: 8 }}>
                  {v.matchConditions.map((c) => (
                    <RowSummary key={c.id} condition={c} accountName={accountName} />
                  ))}
                  {v.categoryRules.map((c) => (
                    <RowSummary key={c.id} condition={c} accountName={accountName} />
                  ))}
                </div>
              </div>
              <div className="row" style={{ gap: 6 }}>
                <button className="btn btn-sm" onClick={() => setOpenTxns((id) => (id === v.id ? null : v.id))}>
                  {openTxns === v.id ? t("cust.vendors.hideTxns") : t("cust.vendors.viewTxns")}
                </button>
                <button className="btn btn-sm" onClick={() => setEditing(v)}>{t("cust.vendors.edit")}</button>
                <button className="btn btn-sm btn-ghost" onClick={() => del(v)}>{t("cust.vendors.delete")}</button>
              </div>
            </div>
            {openTxns === v.id && (
              <div style={{ marginTop: 10, borderTop: "1px solid var(--border)" }}>
                <TransactionBrowser vendorId={v.id} />
              </div>
            )}
          </div>
        );
      })}
    </div>
  );
}
