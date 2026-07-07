"use client";
import React, { useEffect, useMemo, useRef, useState } from "react";
import ReviewMergePicker from "./ReviewMergePicker";
import CatalogBrowser from "./CatalogBrowser";
import VendorEditor, { type Vendor, type Condition, type Refs } from "./VendorEditor";
import SplitDialog, { type SplitParent } from "./SplitDialog";
import { Chip } from "./vendorSummary";
import { useT } from "@/lib/i18n/context";

// Review v2 — the funnel's human hub (F12, FR6). One sectioned page over
// GET /api/review: a counters row spanning every open item, then Unmatched,
// Conflicts, Suspicion flags, and Merges & splits. Every mutation reuses an
// existing route (vendors / catalog / flag-dismiss / merge / splits) and then
// refetches, so the queues shrink live. Amounts are stored Plaid-convention
// (positive = outflow) and rendered user-convention (spend negative) via -amount.

type UnmatchedRow = {
  flagId: string;
  level: "transaction" | "group";
  id: string;
  title: string;
  name: string;
  merchantName: string | null;
  amount: number | null;
  currency: string | null;
  date: string;
  accountId: string;
  paymentChannel: string;
  plaidPrimary: string | null;
  plaidDetailed: string | null;
  plaidConfidence: string | null;
  eligibleForSplit: boolean;
};
type ConflictRow = {
  flagId: string;
  level: "transaction" | "group";
  id: string;
  title: string;
  subtitle: string;
  amount: number | null;
  currency: string | null;
  date: string;
  winnerVendorId: string | null;
  vendors: { id: string; name: string; priority: number | null }[];
};
type SuspicionEntry = {
  flagId: string;
  level: "transaction" | "group";
  transactionId?: string;
  vendor: string | null;
  name?: string;
  title?: string;
  amount: number | null;
  currency: string | null;
  date: string;
  eligibleForSplit: boolean;
};
type Leg = { transactionId: string; name: string | null; amount: number | null };
type GroupRow = {
  id: string;
  title: string;
  vendor: string | null;
  amount: number | null;
  currency: string | null;
  date: string;
  legs: Leg[];
};
type SplitRow = {
  parentTransactionId: string;
  title: string;
  amount: number | null;
  currency: string | null;
  date: string;
  parts: { amount: number | null; label: string | null; categoryName: string | null }[];
};
type ReviewData = {
  counters: { today: number; thisMonth: number; totalOpen: number };
  unmatched: UnmatchedRow[];
  unmatchedTotal: number;
  unmatchedPage: number;
  unmatchedPageSize: number;
  conflicts: ConflictRow[];
  suspicion: Record<string, SuspicionEntry[]>;
  pendingGroups: GroupRow[];
  mergeGroups: GroupRow[];
  splits: SplitRow[];
};

const SUSPICION_RULES = ["unmatched_transfer", "unusual_amount", "duplicate_charge"];

const money = (amount: number | null, currency: string | null) =>
  amount == null ? "—" : `${currency ? currency + " " : ""}${(-amount).toFixed(2)}`;
const day = (iso: string) => new Date(iso).toLocaleDateString();

async function getJson(url: string) {
  const res = await fetch(url);
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.error || "Request failed");
  return data;
}
async function postJson(url: string) {
  const res = await fetch(url, { method: "POST" });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.error || "Request failed");
  return data;
}
async function delJson(url: string, body: unknown) {
  const res = await fetch(url, {
    method: "DELETE",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.error || "Request failed");
  return data;
}

// Pre-fill a vendor condition from an unmatched row: a contains on the merchant
// name when the row has one, else on the transaction name — mirroring the
// merchantName ?? name key the funnel identifies vendors by. Matching normalizes
// both sides, so the raw value is fine (it re-matches the same rows).
function prefillCondition(row: UnmatchedRow): Condition {
  const merch = row.merchantName?.trim();
  const useMerchant = !!merch;
  return {
    categoryName: null,
    nameOp: useMerchant ? null : "contains",
    nameValue: useMerchant ? null : row.name,
    merchantOp: useMerchant ? "contains" : null,
    merchantValue: useMerchant ? merch! : null,
    amountMin: null,
    amountMax: null,
    accountId: null,
    paymentChannel: null,
    plaidPrimary: null,
    plaidDetailed: null,
    plaidConfidence: null,
  };
}
const prefillName = (row: UnmatchedRow) => (row.merchantName?.trim() || row.name || "").slice(0, 100);
// id-less initial → VendorEditor POSTs (create); the pre-fill just seeds the form.
const createInitial = (row: UnmatchedRow): Vendor => ({
  id: "",
  name: prefillName(row),
  link: null,
  iconLink: null,
  icon: null,
  categoryName: null,
  priority: null,
  matchConditions: [prefillCondition(row)],
  categoryRules: [],
});
// Existing vendor + the new row → VendorEditor PATCHes (replace-rows), extending its
// identity (match conditions) so the vendor also claims this row.
const extendInitial = (vendor: Vendor, row: UnmatchedRow): Vendor => ({
  ...vendor,
  matchConditions: [...vendor.matchConditions, prefillCondition(row)],
});

type Modal =
  | { kind: "catalog" }
  | { kind: "create"; row: UnmatchedRow }
  | { kind: "pick"; row: UnmatchedRow }
  | { kind: "extend"; row: UnmatchedRow; vendor: Vendor }
  | { kind: "merge"; seedId?: string }
  | { kind: "split"; parent: SplitParent };

// Build the split dialog's parent from an eligible transaction row. `amount` is
// non-null for transaction rows (Plaid-convention, as stored). `category` is only
// the dialog's default-option label; Review doesn't resolve the live waterfall, so
// it renders "—" — the part category still defaults to null (resolves live).
// ponytail: pass category null; add a resolved label only if the "—" default reads confusing.
const splitParentFromUnmatched = (r: UnmatchedRow): SplitParent => ({
  transactionId: r.id,
  name: r.name,
  amount: r.amount ?? 0,
  currency: r.currency,
  category: null,
});
const splitParentFromSuspicion = (e: SuspicionEntry): SplitParent => ({
  transactionId: e.transactionId!,
  name: e.name ?? e.vendor ?? "",
  amount: e.amount ?? 0,
  currency: e.currency,
  category: null,
});

export default function Review() {
  const t = useT();
  const [data, setData] = useState<ReviewData | null>(null);
  const [vendors, setVendors] = useState<Vendor[]>([]);
  const [categories, setCategories] = useState<string[]>([]);
  const [refs, setRefs] = useState<Refs>({ accounts: [], plaidPrimaries: [], plaidDetaileds: [], plaidConfidences: [] });
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(true);
  const [reloadKey, setReloadKey] = useState(0);
  const [page, setPage] = useState(0);
  const [qInput, setQInput] = useState(""); // what's typed into the unmatched search
  const [q, setQ] = useState(""); // debounced value that drives the fetch
  const [modal, setModal] = useState<Modal | null>(null);

  // Static-ish reference data for the vendor editor (categories + account/plaid refs).
  useEffect(() => {
    (async () => {
      try {
        const [c, r] = await Promise.all([getJson("/api/categories"), getJson("/api/vendors/refs")]);
        setCategories((c.categories ?? []).map((x: { name: string }) => x.name));
        setRefs(r);
      } catch {
        /* editor still works without refs; surfaced on save if truly broken */
      }
    })();
  }, []);

  // Debounce the unmatched search so typing doesn't refetch per keystroke; a fresh
  // query jumps back to the first page.
  useEffect(() => {
    const id = setTimeout(() => {
      setQ(qInput.trim());
      setPage(0);
    }, 300);
    return () => clearTimeout(id);
  }, [qInput]);

  // The vendor list (for "extend an existing vendor" / picker) needs ALL vendors,
  // so it's fetched unpaginated and only refreshed after an action (reloadKey) —
  // not on every unmatched page-turn.
  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const v = await getJson("/api/vendors");
        if (!cancelled) setVendors(v.vendors ?? []);
      } catch {
        /* picker degrades gracefully; the review queues still render */
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [reloadKey]);

  // Review payload (paginated unmatched queue), refetched after every action so the
  // queues shrink live (AC1) and whenever the page/search changes.
  useEffect(() => {
    let cancelled = false;
    (async () => {
      setBusy(true);
      setError("");
      try {
        const rev = await getJson(`/api/review?page=${page}&q=${encodeURIComponent(q)}`);
        if (cancelled) return;
        setData(rev);
      } catch (e: any) {
        if (!cancelled) setError(e.message);
      } finally {
        if (!cancelled) setBusy(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [reloadKey, page, q]);

  // Deep-link scroll (AC8): the sections render from client-fetched JSON, so on a
  // client-side <Link> nav from the Dashboard tiles the anchor isn't in the DOM
  // when Next processes the hash — native hash-scroll only fires on full loads.
  // Once data has rendered, scroll the location.hash target into view (once).
  // Deferred a frame so it runs after Next's nav-scroll-to-top (which fires at
  // nav time, before this async data lands, and would otherwise race us to 0).
  // Hidden/empty section → getElementById is null → no-op (lands at top).
  const scrolledRef = useRef(false);
  useEffect(() => {
    if (!data || scrolledRef.current) return;
    const hash = window.location.hash.slice(1);
    if (!hash) return;
    scrolledRef.current = true;
    requestAnimationFrame(() => document.getElementById(hash)?.scrollIntoView());
  }, [data]);

  // accountId → name for the transaction-detail card (refs come from /api/vendors/refs).
  const accountName = useMemo(() => {
    const m = new Map(refs.accounts.map((a) => [a.accountId, a.name]));
    return (id: string) => m.get(id) ?? id;
  }, [refs]);

  const reload = () => setReloadKey((k) => k + 1);
  const act = async (fn: () => Promise<unknown>) => {
    setBusy(true);
    setError("");
    try {
      await fn();
      reload();
    } catch (e: any) {
      setError(e.message);
      setBusy(false);
    }
  };
  const afterSave = () => {
    setModal(null);
    reload();
  };

  const hasBrowse = !!data && (data.mergeGroups.length > 0 || data.splits.length > 0);
  const nothing =
    !!data &&
    data.counters.totalOpen === 0 &&
    data.pendingGroups.length === 0 &&
    !hasBrowse;

  return (
    <div>
      <h1>{t("review.title")}</h1>

      {data && (
        <div className="row wrap" style={{ gap: 12, marginBottom: 16 }}>
          <Counter label={t("review.countToday")} value={data.counters.today} />
          <Counter label={t("review.thisMonth")} value={data.counters.thisMonth} />
          <Counter label={t("review.totalOpen")} value={data.counters.totalOpen} />
        </div>
      )}

      <div className="row wrap" style={{ marginBottom: 16 }}>
        <div className="spacer" style={{ flex: 1 }} />
        <button className="btn" disabled={busy} onClick={() => setModal({ kind: "merge" })}>
          {t("review.mergeTransactions")}
        </button>
      </div>

      {error && <div className="error">{error}</div>}

      {!data ? (
        <p className="muted">{t("common.loading")}</p>
      ) : nothing ? (
        <div className="card" style={{ textAlign: "center", padding: 32 }}>
          <div style={{ fontSize: 32, color: "var(--success)" }}>✓</div>
          <div style={{ fontSize: 18, fontWeight: 600, marginTop: 8 }}>{t("review.allClear")}</div>
          <p className="muted" style={{ marginBottom: 0 }}>{t("review.allClearBody")}</p>
        </div>
      ) : (
        <>
          <UnmatchedSection
            rows={data.unmatched}
            total={data.unmatchedTotal}
            page={data.unmatchedPage}
            pageSize={data.unmatchedPageSize}
            setPage={setPage}
            q={qInput}
            setQ={setQInput}
            busy={busy}
            onCreate={(row) => setModal({ kind: "create", row })}
            onExtend={(row) => setModal({ kind: "pick", row })}
            onCatalog={() => setModal({ kind: "catalog" })}
            onSplit={(row) => setModal({ kind: "split", parent: splitParentFromUnmatched(row) })}
          />

          <ConflictSection rows={data.conflicts} busy={busy} act={act} />

          <SuspicionSection
            suspicion={data.suspicion}
            busy={busy}
            act={act}
            onMerge={(id) => setModal({ kind: "merge", seedId: id })}
            onSplit={(entry) => setModal({ kind: "split", parent: splitParentFromSuspicion(entry) })}
          />

          <MergeSplitSection data={data} busy={busy} act={act} />
        </>
      )}

      {/* --- Modals --- */}
      {modal?.kind === "merge" && (
        <ReviewMergePicker seedId={modal.seedId} onClose={() => setModal(null)} onMerged={afterSave} />
      )}
      {modal?.kind === "split" && (
        <SplitDialog parent={modal.parent} onClose={() => setModal(null)} onDone={afterSave} />
      )}
      {modal?.kind === "catalog" && (
        <Overlay onClose={() => setModal(null)}>
          <CatalogBrowser onClose={() => setModal(null)} onInstantiated={afterSave} />
        </Overlay>
      )}
      {modal?.kind === "create" && (
        <Overlay onClose={() => setModal(null)} maxWidth={860}>
          <TxnDetail row={modal.row} accountName={accountName} />
          <VendorEditor
            initial={createInitial(modal.row)}
            categories={categories}
            refs={refs}
            onCancel={() => setModal(null)}
            onSaved={afterSave}
          />
        </Overlay>
      )}
      {modal?.kind === "pick" && (
        <Overlay onClose={() => setModal(null)}>
          <TxnDetail row={modal.row} accountName={accountName} />
          <VendorPicker
            vendors={vendors}
            onPick={(vendor) => setModal({ kind: "extend", row: modal.row, vendor })}
            onClose={() => setModal(null)}
          />
        </Overlay>
      )}
      {modal?.kind === "extend" && (
        <Overlay onClose={() => setModal(null)} maxWidth={860}>
          <TxnDetail row={modal.row} accountName={accountName} />
          <VendorEditor
            initial={extendInitial(modal.vendor, modal.row)}
            categories={categories}
            refs={refs}
            onCancel={() => setModal(null)}
            onSaved={afterSave}
          />
        </Overlay>
      )}
    </div>
  );
}

// --- Sections ---------------------------------------------------------------

function UnmatchedSection({
  rows,
  total,
  page,
  pageSize,
  setPage,
  q,
  setQ,
  busy,
  onCreate,
  onExtend,
  onCatalog,
  onSplit,
}: {
  rows: UnmatchedRow[];
  total: number;
  page: number;
  pageSize: number;
  setPage: (n: number) => void;
  q: string;
  setQ: (s: string) => void;
  busy: boolean;
  onCreate: (row: UnmatchedRow) => void;
  onExtend: (row: UnmatchedRow) => void;
  onCatalog: () => void;
  onSplit: (row: UnmatchedRow) => void;
}) {
  const t = useT();
  // Hide only when there's genuinely nothing to review here; keep the section (and
  // its search box) up while a query is active so it can be cleared even at 0 hits.
  if (total === 0 && !q.trim()) return null;
  const pages = Math.max(1, Math.ceil(total / pageSize));
  const p = Math.min(page, pages - 1);
  return (
    <Section id="unmatched" title={t("review.unmatchedTitle", { n: total })} help={t("review.unmatchedHelp")}>
      <div className="row" style={{ marginBottom: 8 }}>
        <input
          className="input"
          style={{ maxWidth: 320 }}
          placeholder={t("review.searchUnmatched")}
          value={q}
          onChange={(e) => setQ(e.target.value)}
        />
      </div>
      {rows.length === 0 ? (
        <p className="muted">{t("review.noUnmatchedMatch", { q: q.trim() })}</p>
      ) : (
      <div className="card" style={{ padding: 0 }}>
        <table>
          <thead>
            <tr>
              <th>{t("review.colItem")}</th>
              <th>{t("review.colAmount")}</th>
              <th>{t("review.colDate")}</th>
              <th>{t("review.colActions")}</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((r) => (
              <tr key={r.flagId}>
                <td>
                  <strong>{r.merchantName?.trim() || r.name}</strong>
                  <div className="muted" style={{ fontSize: 12 }}>
                    {r.level === "group" ? `${t("review.mergedGroup")} · ${r.title}` : r.name}
                  </div>
                </td>
                <td>{money(r.amount, r.currency)}</td>
                <td>{day(r.date)}</td>
                <td style={{ whiteSpace: "nowrap" }}>
                  <div className="row" style={{ flexWrap: "nowrap" }}>
                    <button className="btn btn-sm btn-primary" disabled={busy} onClick={() => onCreate(r)}>
                      {t("review.createVendor")}
                    </button>
                    <button className="btn btn-sm" disabled={busy} onClick={() => onExtend(r)}>
                      {t("review.addToVendor")}
                    </button>
                    <button className="btn btn-sm btn-ghost" disabled={busy} onClick={onCatalog}>
                      {t("review.fromCatalog")}
                    </button>
                    {r.level === "transaction" && r.eligibleForSplit && (
                      <button className="btn btn-sm btn-ghost" disabled={busy} onClick={() => onSplit(r)}>
                        {t("review.split")}
                      </button>
                    )}
                  </div>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      )}
      {pages > 1 && (
        <div className="row" style={{ gap: 10, marginTop: 8, alignItems: "center" }}>
          <button className="btn btn-sm" disabled={p === 0} onClick={() => setPage(p - 1)}>
            {t("review.prev")}
          </button>
          <span className="muted">{t("review.pageOf", { page: p + 1, pages })}</span>
          <button className="btn btn-sm" disabled={p >= pages - 1} onClick={() => setPage(p + 1)}>
            {t("review.next")}
          </button>
        </div>
      )}
    </Section>
  );
}

function ConflictSection({
  rows,
  busy,
  act,
}: {
  rows: ConflictRow[];
  busy: boolean;
  act: (fn: () => Promise<unknown>) => void;
}) {
  const t = useT();
  if (rows.length === 0) return null;
  return (
    <Section id="conflicts" title={t("review.conflictsTitle", { n: rows.length })} help={t("review.conflictsHelp")}>
      <div className="card" style={{ padding: 0 }}>
        <table>
          <thead>
            <tr>
              <th>{t("review.colItem")}</th>
              <th>{t("review.colMatches")}</th>
              <th>{t("review.colAmount")}</th>
              <th>{t("review.colActions")}</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((r) => (
              <tr key={r.flagId}>
                <td>
                  <strong>{r.title}</strong>
                  <div className="muted" style={{ fontSize: 12 }}>{day(r.date)} · {r.subtitle}</div>
                </td>
                <td>
                  <div className="row wrap" style={{ gap: 6 }}>
                    {r.vendors.map((v) => {
                      const winner = v.id === r.winnerVendorId;
                      return (
                        <span
                          key={v.id}
                          title={winner ? t("review.winner") : undefined}
                          style={{
                            display: "inline-block",
                            fontSize: 12,
                            padding: "2px 8px",
                            borderRadius: 999,
                            whiteSpace: "nowrap",
                            background: winner ? "rgba(21,104,74,0.12)" : "var(--bg-3)",
                            color: winner ? "var(--primary)" : "var(--muted)",
                            border: `1px solid ${winner ? "rgba(21,104,74,0.25)" : "var(--border)"}`,
                            fontWeight: winner ? 700 : 400,
                          }}
                        >
                          {winner ? "★ " : ""}
                          {v.name} #{v.priority}
                        </span>
                      );
                    })}
                  </div>
                </td>
                <td>{money(r.amount, r.currency)}</td>
                <td>
                  <div className="row wrap">
                    <a className="btn btn-sm" href="/vendors">
                      {t("review.editVendors")}
                    </a>
                  </div>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </Section>
  );
}

function SuspicionSection({
  suspicion,
  busy,
  act,
  onMerge,
  onSplit,
}: {
  suspicion: Record<string, SuspicionEntry[]>;
  busy: boolean;
  act: (fn: () => Promise<unknown>) => void;
  onMerge: (transactionId: string) => void;
  onSplit: (entry: SuspicionEntry) => void;
}) {
  const t = useT();
  const anything = SUSPICION_RULES.some((rule) => (suspicion[rule] ?? []).length > 0);
  if (!anything) return null;
  return (
    <Section id="suspicion" title={t("review.suspicionTitle")} help={t("review.suspicionHelp")}>
      {SUSPICION_RULES.map((rule) => {
        const entries = suspicion[rule] ?? [];
        if (!entries.length) return null;
        return (
          <div key={rule} style={{ marginBottom: 14 }}>
            <h3 style={{ fontSize: 14, margin: "8px 0 6px" }}>
              {t(`rule.${rule}`)} ({entries.length})
            </h3>
            <div className="card" style={{ padding: 0 }}>
              <table>
                <thead>
                  <tr>
                    <th>{t("review.colItem")}</th>
                    <th>{t("review.colAmount")}</th>
                    <th>{t("review.colDate")}</th>
                    <th>{t("review.colActions")}</th>
                  </tr>
                </thead>
                <tbody>
                  {entries.map((e) => (
                    <tr key={e.flagId}>
                      <td>
                        <strong>{e.level === "group" ? e.title : e.vendor}</strong>
                        <div className="muted" style={{ fontSize: 12 }}>
                          {e.level === "group" ? `${t("review.mergedGroup")} · ${e.vendor ?? "—"}` : e.name}
                        </div>
                      </td>
                      <td>{money(e.amount, e.currency)}</td>
                      <td>{day(e.date)}</td>
                      <td>
                        <div className="row wrap">
                          {e.level === "transaction" && e.transactionId && (
                            <button className="btn btn-sm" disabled={busy} onClick={() => onMerge(e.transactionId!)}>
                              {t("review.merge")}
                            </button>
                          )}
                          {e.level === "transaction" && e.eligibleForSplit && (
                            <button className="btn btn-sm" disabled={busy} onClick={() => onSplit(e)}>
                              {t("review.split")}
                            </button>
                          )}
                          <button
                            className="btn btn-sm btn-ghost"
                            disabled={busy}
                            onClick={() => act(() => postJson(`/api/flags/${e.flagId}/dismiss`))}
                          >
                            {t("review.dismiss")}
                          </button>
                        </div>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        );
      })}
    </Section>
  );
}

function MergeSplitSection({
  data,
  busy,
  act,
}: {
  data: ReviewData;
  busy: boolean;
  act: (fn: () => Promise<unknown>) => void;
}) {
  const t = useT();
  const { pendingGroups, mergeGroups, splits } = data;
  if (pendingGroups.length === 0 && mergeGroups.length === 0 && splits.length === 0) return null;
  return (
    <Section id="pending" title={t("review.mergesSplitsTitle")} help={t("review.mergesSplitsHelp")}>
      {pendingGroups.length > 0 && (
        <GroupTable
          title={t("review.pendingGroups", { n: pendingGroups.length })}
          groups={pendingGroups}
          busy={busy}
          renderActions={(g) => (
            <>
              <button
                className="btn btn-sm btn-primary"
                disabled={busy}
                onClick={() => act(() => postJson(`/api/merge/${g.id}/confirm`))}
              >
                {t("review.confirm")}
              </button>
              <button
                className="btn btn-sm"
                disabled={busy}
                onClick={() => act(() => postJson(`/api/merge/${g.id}/dissolve`))}
              >
                {t("review.dissolve")}
              </button>
            </>
          )}
        />
      )}

      {mergeGroups.length > 0 && (
        <GroupTable
          title={t("review.allMerges", { n: mergeGroups.length })}
          groups={mergeGroups}
          busy={busy}
          renderActions={(g) => (
            <button
              className="btn btn-sm"
              disabled={busy}
              onClick={() => act(() => postJson(`/api/merge/${g.id}/dissolve`))}
            >
              {t("review.dissolve")}
            </button>
          )}
        />
      )}

      {splits.length > 0 && (
        <div style={{ marginBottom: 14 }}>
          <h3 style={{ fontSize: 14, margin: "8px 0 6px" }}>{t("review.allSplits", { n: splits.length })}</h3>
          <div className="card" style={{ padding: 0 }}>
            <table>
              <thead>
                <tr>
                  <th>{t("review.colItem")}</th>
                  <th>{t("review.colAmount")}</th>
                  <th>{t("review.colDate")}</th>
                  <th>{t("review.colActions")}</th>
                </tr>
              </thead>
              <tbody>
                {splits.map((s) => (
                  <tr key={s.parentTransactionId}>
                    <td>
                      <strong>{s.title}</strong>
                      <div className="muted" style={{ fontSize: 12 }}>
                        {s.parts
                          .map((pt) => `${pt.label ?? t("review.part")} ${money(pt.amount, s.currency)}${pt.categoryName ? ` (${pt.categoryName})` : ""}`)
                          .join("  +  ")}
                      </div>
                    </td>
                    <td>{money(s.amount, s.currency)}</td>
                    <td>{day(s.date)}</td>
                    <td>
                      <button
                        className="btn btn-sm"
                        disabled={busy}
                        onClick={() => act(() => delJson("/api/splits", { parentTransactionId: s.parentTransactionId }))}
                      >
                        {t("review.unsplit")}
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </Section>
  );
}

// --- Small shared pieces ----------------------------------------------------

function GroupTable({
  title,
  groups,
  busy,
  renderActions,
}: {
  title: string;
  groups: GroupRow[];
  busy: boolean;
  renderActions: (g: GroupRow) => React.ReactNode;
}) {
  const t = useT();
  return (
    <div style={{ marginBottom: 14 }}>
      <h3 style={{ fontSize: 14, margin: "8px 0 6px" }}>{title}</h3>
      <div className="card" style={{ padding: 0 }}>
        <table>
          <thead>
            <tr>
              <th>{t("review.colGroup")}</th>
              <th>{t("review.colNet")}</th>
              <th>{t("review.colDate")}</th>
              <th>{t("review.colActions")}</th>
            </tr>
          </thead>
          <tbody>
            {groups.map((g) => (
              <tr key={g.id}>
                <td>
                  <strong>{g.title}</strong>
                  <div className="muted" style={{ fontSize: 12 }}>
                    {g.legs.map((l) => `${l.name ?? l.transactionId} (${money(l.amount, g.currency)})`).join("  +  ")}
                  </div>
                </td>
                <td>{money(g.amount, g.currency)}</td>
                <td>{day(g.date)}</td>
                <td>
                  <div className="row wrap">{renderActions(g)}</div>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

function Section({ id, title, help, children }: { id?: string; title: string; help?: string; children: React.ReactNode }) {
  return (
    <section id={id} style={{ marginBottom: 28, scrollMarginTop: 16 }}>
      <h2 style={{ fontSize: 17, margin: "20px 0 4px" }}>{title}</h2>
      {help && <p className="muted" style={{ marginTop: 0, fontSize: 13 }}>{help}</p>}
      {children}
    </section>
  );
}

function Counter({ label, value }: { label: string; value: number }) {
  return (
    <div className="card" style={{ margin: 0, minWidth: 130 }}>
      <div style={{ fontSize: 26, fontWeight: 700 }}>{value}</div>
      <div className="muted">{label}</div>
    </div>
  );
}

// The source transaction, shown atop the create / add-to-vendor modals so it's
// clear which row is being matched (the editor form only shows the pre-fill).
// Fields render as the same colored chips the vendors page uses (vendorSummary),
// so the detail reads consistently with the condition builder.
function TxnDetail({ row, accountName }: { row: UnmatchedRow; accountName: (id: string) => string }) {
  const t = useT();
  const heading = row.level === "group" ? row.title : row.name;
  return (
    <div className="card" style={{ margin: 0, marginBottom: 12, background: "var(--bg-3)" }}>
      <div className="muted" style={{ fontSize: 11, textTransform: "uppercase", letterSpacing: 0.5, marginBottom: 6 }}>
        {row.level === "group" ? `${t("review.txnDetail")} · ${t("review.mergedGroup")}` : t("review.txnDetail")}
      </div>
      <div className="row wrap" style={{ gap: 16, alignItems: "baseline", marginBottom: 8 }}>
        <strong style={{ fontSize: 15 }}>{heading}</strong>
        <span style={{ fontWeight: 600 }}>{money(row.amount, row.currency)}</span>
        <span className="muted">{day(row.date)}</span>
      </div>
      <div className="row wrap" style={{ gap: 6 }}>
        {row.merchantName?.trim() && (
          <Chip tone="merchant">{t("cust.vendors.merchantName")}: {row.merchantName.trim()}</Chip>
        )}
        <Chip tone="account">{t("cust.vendors.account")}: {accountName(row.accountId)}</Chip>
        {row.paymentChannel && <Chip tone="channel">{t("cust.vendors.channel")}: {row.paymentChannel}</Chip>}
        {row.plaidPrimary && <Chip tone="plaidPrimary">{t("cust.vendors.plaidPrimary")}: {row.plaidPrimary}</Chip>}
        {row.plaidDetailed && <Chip tone="plaidDetailed">{t("cust.vendors.plaidDetailed")}: {row.plaidDetailed}</Chip>}
        {row.plaidConfidence && <Chip tone="plaidConfidence">{t("cust.vendors.plaidConfidence")}: {row.plaidConfidence}</Chip>}
      </div>
    </div>
  );
}

// Centered overlay wrapper so VendorEditor / CatalogBrowser (plain cards) render
// as modals — same shell ReviewMergePicker uses inline.
function Overlay({
  children,
  onClose,
  maxWidth = 640,
}: {
  children: React.ReactNode;
  onClose: () => void;
  maxWidth?: number;
}) {
  return (
    <div
      style={{
        position: "fixed",
        inset: 0,
        background: "rgba(0,0,0,0.6)",
        display: "flex",
        alignItems: "flex-start",
        justifyContent: "center",
        padding: "40px 16px",
        overflow: "auto",
        zIndex: 50,
      }}
      onClick={onClose}
    >
      <div style={{ maxWidth, width: "100%" }} onClick={(ev) => ev.stopPropagation()}>
        {children}
      </div>
    </div>
  );
}

// Choose which existing vendor to extend with the new equals condition.
function VendorPicker({
  vendors,
  onPick,
  onClose,
}: {
  vendors: Vendor[];
  onPick: (v: Vendor) => void;
  onClose: () => void;
}) {
  const t = useT();
  const [q, setQ] = useState("");
  const filtered = useMemo(() => {
    const needle = q.trim().toLowerCase();
    return needle ? vendors.filter((v) => v.name.toLowerCase().includes(needle)) : vendors;
  }, [vendors, q]);
  return (
    <div className="card" style={{ margin: 0 }}>
      <div className="row" style={{ justifyContent: "space-between", marginBottom: 8 }}>
        <div className="card-header" style={{ margin: 0 }}>{t("review.pickVendor")}</div>
        <button className="btn btn-sm btn-ghost" onClick={onClose}>{t("common.cancel")}</button>
      </div>
      {vendors.length === 0 ? (
        <p className="muted">{t("review.noVendors")}</p>
      ) : (
        <>
          <input
            className="input"
            style={{ width: "100%", marginBottom: 8 }}
            placeholder={t("review.searchVendors")}
            value={q}
            onChange={(e) => setQ(e.target.value)}
            autoFocus
          />
          {filtered.length === 0 ? (
            <p className="muted">{t("review.noVendorMatch", { q: q.trim() })}</p>
          ) : (
        <div style={{ maxHeight: 360, overflow: "auto", border: "1px solid var(--border)", borderRadius: 6 }}>
          {filtered.map((v) => (
            <button
              key={v.id}
              type="button"
              className="row"
              style={{
                width: "100%",
                gap: 8,
                padding: "8px 12px",
                borderBottom: "1px solid var(--border)",
                background: "none",
                border: "none",
                cursor: "pointer",
                textAlign: "left",
              }}
              onClick={() => onPick(v)}
            >
              <strong style={{ flex: 1 }}>{v.name}</strong>
              <span className="muted" style={{ fontSize: 12 }}>
                {t("review.condCount", { n: v.matchConditions.length + v.categoryRules.length })}
              </span>
            </button>
          ))}
        </div>
          )}
        </>
      )}
    </div>
  );
}
