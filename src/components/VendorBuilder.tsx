"use client";
import React, { useEffect, useMemo, useState } from "react";
import { useT } from "@/lib/i18n/context";
import { VendorIcon } from "./VendorIcon";
import VendorEditor, { type Vendor, type Refs } from "./VendorEditor";
import CatalogBrowser from "./CatalogBrowser";
import TransactionBrowser from "./TransactionBrowser";
import { RowSummary, Chip } from "./vendorSummary";

// A cuid is long; show a short handle (first6…last4) so ids stay readable.
const shortId = (id: string): string => (id.length > 12 ? `${id.slice(0, 6)}…${id.slice(-4)}` : id);

// F10 vendor builder + catalog browser. Fills the Vendors slot F9 left in
// /customizations. Priority-ordered list (reorder → F3 endpoint), a full condition
// builder (create/edit → F3 CRUD), and the catalog browser (instantiate → F4).
export default function VendorBuilder() {
  const t = useT();
  const [vendors, setVendors] = useState<Vendor[] | null>(null);
  const [total, setTotal] = useState(0);
  const [orderedIds, setOrderedIds] = useState<string[]>([]); // full priority order (all pages)
  const [pageSize, setPageSize] = useState(25);
  const [page, setPage] = useState(0);
  const [qInput, setQInput] = useState(""); // what's typed
  const [q, setQ] = useState(""); // debounced value that drives the fetch
  const [category, setCategory] = useState(""); // "" = all default categories
  const [reloadKey, setReloadKey] = useState(0);
  const [categories, setCategories] = useState<string[]>([]);
  const [refs, setRefs] = useState<Refs>({ accounts: [], plaidPrimaries: [], plaidDetaileds: [], plaidConfidences: [] });
  const [loadError, setLoadError] = useState<string | null>(null);
  const [editing, setEditing] = useState<Vendor | null | "new">(null); // null = closed, "new" = create
  const [showCatalog, setShowCatalog] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);
  const [rowError, setRowError] = useState<string | null>(null);
  const [openTxns, setOpenTxns] = useState<string | null>(null); // vendor id whose txns are shown

  const refresh = () => setReloadKey((k) => k + 1);

  // Debounce the search; a fresh query resets to the first page.
  useEffect(() => {
    const id = setTimeout(() => {
      setQ(qInput.trim());
      setPage(0);
    }, 300);
    return () => clearTimeout(id);
  }, [qInput]);

  // One-time reference data (categories + account/plaid refs) for the editor.
  useEffect(() => {
    (async () => {
      const [c, r] = await Promise.all([fetch("/api/categories"), fetch("/api/vendors/refs")]);
      if (c.ok) setCategories((await c.json()).categories.map((x: { name: string }) => x.name));
      if (r.ok) setRefs(await r.json());
    })();
  }, []);

  // The paginated + searchable vendor list. Refetched on page/search change and
  // after every mutation (reloadKey).
  useEffect(() => {
    let cancelled = false;
    (async () => {
      const res = await fetch(
        `/api/vendors?page=${page}&q=${encodeURIComponent(q)}&category=${encodeURIComponent(category)}`
      );
      if (cancelled) return;
      if (!res.ok) return setLoadError(t("cust.vendors.loadFailed"));
      const data = await res.json();
      setVendors(data.vendors);
      setTotal(data.total ?? data.vendors.length);
      setOrderedIds(data.orderedIds ?? []);
      setPageSize(data.pageSize ?? 25);
    })();
    return () => {
      cancelled = true;
    };
  }, [page, q, category, reloadKey]);

  const accountName = useMemo(() => {
    const m = new Map(refs.accounts.map((a) => [a.accountId, a.name]));
    return (id: string) => m.get(id) ?? id;
  }, [refs]);

  const pages = Math.max(1, Math.ceil(total / pageSize));

  // Reorder walks the FULL priority order (orderedIds) so it works across pages.
  // The reorder API needs exactly the priority-bearing vendors, and orderedIds is
  // precisely that list. Arrows are hidden while searching (positions are ambiguous).
  async function move(index: number, dir: -1 | 1) {
    const next = index + dir;
    if (next < 0 || next >= orderedIds.length) return;
    const ids = [...orderedIds];
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

  // Sharing / snapshot-link lifecycle: share|unshare a rule, or resync|detach a
  // linked snapshot. One endpoint; the list is refreshed after every action.
  async function sharing(v: Vendor, action: "share" | "unshare" | "resync" | "detach") {
    setRowError(null);
    const res = await fetch("/api/vendors/sharing", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ id: v.id, action }),
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) return setRowError(data.error ?? t("common.genericError"));
    await refresh();
    if (action === "share") setNotice(t("cust.vendors.nowShared", { name: v.name }));
    if (action === "resync") setNotice(t("cust.vendors.resynced", { name: v.name, count: data.claimed ?? 0 }));
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

      <div className="row" style={{ gap: 8, marginBottom: 16, alignItems: "center" }}>
        <button className="btn btn-primary" disabled={editing === "new"} onClick={() => setEditing("new")}>{t("cust.vendors.add")}</button>
        <button className="btn" onClick={() => setShowCatalog((s) => !s)}>{t("cust.vendors.browseCatalog")}</button>
        <div className="spacer" style={{ flex: 1 }} />
        <select
          className="input"
          style={{ maxWidth: 200 }}
          value={category}
          onChange={(e) => {
            setCategory(e.target.value);
            setPage(0);
          }}
        >
          <option value="">{t("cust.vendors.allCategories")}</option>
          {categories.map((c) => (
            <option key={c} value={c}>{c}</option>
          ))}
        </select>
        <input
          className="input"
          style={{ maxWidth: 260 }}
          placeholder={t("cust.vendors.search")}
          value={qInput}
          onChange={(e) => setQInput(e.target.value)}
        />
      </div>

      {editing === "new" && <div className="editor-wide" style={{ marginBottom: 16 }}>{editor(null)}</div>}

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

      {vendors.length === 0 && (
        <p className="muted">
          {q.trim() || category
            ? t("cust.vendors.noMatch", { q: q.trim() || category })
            : t("cust.vendors.empty")}
        </p>
      )}

      {vendors.map((v) => {
        // Edit opens the editor as a SEPARATE row below — the vendor's own row stays
        // visible (so you can see what you're editing against), rather than being
        // swapped out for the editor.
        const isEditing = editing !== "new" && editing?.id === v.id;
        const idx = orderedIds.indexOf(v.id);
        const canReorder = idx !== -1 && !q.trim() && !category;
        return (
          <React.Fragment key={v.id}>
            <div className="card">
              <div className="row" style={{ gap: 12, alignItems: "flex-start" }}>
                {/* reorder controls */}
                {canReorder && (
                  <div style={{ display: "flex", flexDirection: "column", gap: 2 }}>
                    <button className="btn btn-sm btn-ghost" style={{ padding: "2px 6px" }} disabled={idx === 0} onClick={() => move(idx, -1)} title={t("cust.vendors.moveUp")}>▲</button>
                    <button className="btn btn-sm btn-ghost" style={{ padding: "2px 6px" }} disabled={idx === orderedIds.length - 1} onClick={() => move(idx, 1)} title={t("cust.vendors.moveDown")}>▼</button>
                  </div>
                )}
                <VendorIcon name={v.name} link={v.link} icon={v.icon} size={34} />
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div className="row wrap" style={{ gap: 10 }}>
                    <strong style={{ fontSize: 15 }}>{v.name}</strong>
                    {v.categoryName && <Chip tone="cat">{t("cust.vendors.defaultChip", { name: v.categoryName })}</Chip>}
                    {v.shared && <Chip tone="cat">{t("cust.vendors.sharedChip")}</Chip>}
                    {v.linkedFromId && (
                      <Chip>
                        {v.linkedFrom
                          ? t("cust.vendors.linkedChip", { id: shortId(v.linkedFrom.userId) })
                          : t("cust.vendors.linkedRemoved")}
                      </Chip>
                    )}
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
                <div className="row wrap" style={{ gap: 6, justifyContent: "flex-end" }}>
                  <button className="btn btn-sm" onClick={() => setOpenTxns((id) => (id === v.id ? null : v.id))}>
                    {openTxns === v.id ? t("cust.vendors.hideTxns") : t("cust.vendors.viewTxns")}
                  </button>
                  {v.linkedFromId ? (
                    // Adopted snapshot-link: read-only. Re-pull the source, or detach to edit.
                    <>
                      <button className="btn btn-sm" onClick={() => sharing(v, "resync")} title={t("cust.vendors.updateHelp")}>{t("cust.vendors.updateFromSource")}</button>
                      <button className="btn btn-sm" onClick={() => sharing(v, "detach")} title={t("cust.vendors.customizeHelp")}>{t("cust.vendors.customize")}</button>
                    </>
                  ) : (
                    <>
                      <button className="btn btn-sm" onClick={() => sharing(v, v.shared ? "unshare" : "share")} title={t("cust.vendors.shareHelp")}>
                        {v.shared ? t("cust.vendors.unshare") : t("cust.vendors.share")}
                      </button>
                      <button className="btn btn-sm" onClick={() => setEditing((e) => (e !== "new" && e?.id === v.id ? null : v))}>{t("cust.vendors.edit")}</button>
                    </>
                  )}
                  <button className="btn btn-sm btn-ghost" onClick={() => del(v)}>{t("cust.vendors.delete")}</button>
                </div>
              </div>
              {openTxns === v.id && (
                <div style={{ marginTop: 10, borderTop: "1px solid var(--border)" }}>
                  <TransactionBrowser vendorId={v.id} />
                </div>
              )}
            </div>
            {isEditing && <div className="editor-wide" style={{ margin: "8px 0 16px" }}>{editor(editing)}</div>}
          </React.Fragment>
        );
      })}

      {pages > 1 && (
        <div className="row" style={{ gap: 10, marginTop: 12, alignItems: "center" }}>
          <button className="btn btn-sm" disabled={page === 0} onClick={() => setPage(page - 1)}>
            {t("review.prev")}
          </button>
          <span className="muted">{t("review.pageOf", { page: page + 1, pages })}</span>
          <button className="btn btn-sm" disabled={page >= pages - 1} onClick={() => setPage(page + 1)}>
            {t("review.next")}
          </button>
        </div>
      )}
    </div>
  );
}
