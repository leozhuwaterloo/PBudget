"use client";
import React, { useState } from "react";
import { useT } from "@/lib/i18n/context";

// Shared vendor shapes (the /api/vendors serialization + refs the editor needs).
// Two-stage model: `matchConditions` decide identity (any match → the vendor claims
// the txn); `categoryRules` refine the category (first match → its category, else
// the default). A category rule carries `categoryName`; a match condition doesn't.
export type Condition = {
  id?: string;
  categoryName?: string | null;
  nameOp: string | null;
  nameValue: string | null;
  merchantOp: string | null;
  merchantValue: string | null;
  amountMin: number | null;
  amountMax: number | null;
  accountId: string | null;
  paymentChannel: string | null;
  plaidPrimary: string | null;
  plaidDetailed: string | null;
  plaidConfidence: string | null;
};
export type Vendor = {
  id: string;
  name: string;
  link: string | null;
  iconLink: string | null;
  icon: string | null;
  categoryName: string | null;
  priority: number | null;
  matchConditions: Condition[];
  categoryRules: Condition[];
};
export type Account = { accountId: string; name: string; subtype: string | null };
export type Refs = { accounts: Account[]; plaidPrimaries: string[]; plaidDetaileds: string[]; plaidConfidences: string[] };

// Text-match operators offered in the editor. Deliberately just contains + regex;
// equals/starts_with are retired (the matcher still honors any legacy rows).
const TEXT_OPS = ["contains", "regex"];
const CHANNELS = ["online", "in store", "other"];

// Row form state: everything a string (inputs), converted at save.
type RowForm = {
  key: string;
  categoryName: string;
  nameOp: string;
  nameValue: string;
  merchantOp: string;
  merchantValue: string;
  amountMin: string;
  amountMax: string;
  accountId: string;
  paymentChannel: string;
  plaidPrimary: string;
  plaidDetailed: string;
  plaidConfidence: string;
};

let rowSeq = 0;
const newKey = () => `r${rowSeq++}`;

function toRowForm(c: Condition): RowForm {
  return {
    key: newKey(),
    categoryName: c.categoryName ?? "",
    nameOp: c.nameOp ?? "contains",
    nameValue: c.nameValue ?? "",
    merchantOp: c.merchantOp ?? "contains",
    merchantValue: c.merchantValue ?? "",
    amountMin: c.amountMin == null ? "" : String(c.amountMin),
    amountMax: c.amountMax == null ? "" : String(c.amountMax),
    accountId: c.accountId ?? "",
    paymentChannel: c.paymentChannel ?? "",
    plaidPrimary: c.plaidPrimary ?? "",
    plaidDetailed: c.plaidDetailed ?? "",
    plaidConfidence: c.plaidConfidence ?? "",
  };
}

const emptyRow = (): RowForm => toRowForm({
  categoryName: null, nameOp: null, nameValue: null, merchantOp: null, merchantValue: null,
  amountMin: null, amountMax: null, accountId: null, paymentChannel: null, plaidPrimary: null, plaidDetailed: null,
  plaidConfidence: null,
});

// Serialize a row to the API body. Text pairs are only sent when a value is
// present (so an untouched default op never trips the "needs both" validator).
// `withCategory` includes the row's category outcome (category rules only).
function rowBody(r: RowForm, withCategory: boolean) {
  const num = (s: string) => (s.trim() === "" ? null : Number(s));
  return {
    ...(withCategory ? { categoryName: r.categoryName || null } : {}),
    nameOp: r.nameValue.trim() ? r.nameOp : null,
    nameValue: r.nameValue.trim() || null,
    merchantOp: r.merchantValue.trim() ? r.merchantOp : null,
    merchantValue: r.merchantValue.trim() || null,
    amountMin: num(r.amountMin),
    amountMax: num(r.amountMax),
    accountId: r.accountId || null,
    paymentChannel: r.paymentChannel || null,
    plaidPrimary: r.plaidPrimary.trim() || null,
    plaidDetailed: r.plaidDetailed.trim() || null,
    plaidConfidence: r.plaidConfidence.trim() || null,
  };
}

// Create or edit a vendor. Edit vs create keys off initial?.id (not initial's
// truthiness) so callers can pass a PREFILLED create (id-less initial, e.g. F12's
// "create vendor from an unmatched row"). Posts/patches /api/vendors and calls
// onSaved with the returned vendor; surfaces the API's save-time error inline.
export default function VendorEditor({
  initial,
  categories,
  refs,
  onSaved,
  onCancel,
}: {
  initial: Vendor | null;
  categories: string[];
  refs: Refs;
  onSaved: (v: Vendor) => void;
  onCancel: () => void;
}) {
  const t = useT();
  const [name, setName] = useState(initial?.name ?? "");
  const [link, setLink] = useState(initial?.link ?? "");
  const [iconLink, setIconLink] = useState(initial?.iconLink ?? "");
  const [defaultCat, setDefaultCat] = useState(initial?.categoryName ?? "");
  const [matchRows, setMatchRows] = useState<RowForm[]>(
    initial && initial.matchConditions.length ? initial.matchConditions.map(toRowForm) : [emptyRow()]
  );
  const [catRows, setCatRows] = useState<RowForm[]>(
    initial && initial.categoryRules.length ? initial.categoryRules.map(toRowForm) : []
  );
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  async function save() {
    setError(null);
    setSaving(true);
    const body = {
      ...(initial?.id ? { id: initial.id } : {}),
      name,
      link: link.trim() || null,
      iconLink: iconLink.trim() || null,
      categoryName: defaultCat || null,
      matchConditions: matchRows.map((r) => rowBody(r, false)),
      categoryRules: catRows.map((r) => rowBody(r, true)),
    };
    const res = await fetch("/api/vendors", {
      method: initial?.id ? "PATCH" : "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
    setSaving(false);
    const data = await res.json().catch(() => ({}));
    if (!res.ok) return setError(data.error ?? t("common.genericError"));
    onSaved(data as Vendor);
  }

  return (
    <div className="card" style={{ borderColor: "var(--primary)" }}>
      <div className="card-header">
        {initial?.id ? t("cust.vendors.editTitle") : t("cust.vendors.createTitle")}
      </div>

      {/* Vendor-level fields */}
      <div className="field-grid">
        <div>
          <label>{t("cust.vendors.name")}</label>
          <input value={name} onChange={(e) => setName(e.target.value)} placeholder={t("cust.vendors.namePlaceholder")} />
        </div>
        <div>
          <label>{t("cust.vendors.defaultCategory")}</label>
          <CategorySelect value={defaultCat} categories={categories} onChange={setDefaultCat} noneLabel={t("cust.vendors.chooseCategory")} />
        </div>
        <div>
          <label>{t("cust.vendors.link")}</label>
          <input type="url" inputMode="url" value={link} onChange={(e) => setLink(e.target.value)} placeholder={t("cust.vendors.linkPlaceholder")} />
        </div>
        <div>
          <label>{t("cust.vendors.iconLink")}</label>
          <div className="row" style={{ gap: 8, alignItems: "center" }}>
            {iconLink.trim() && (
              // Live preview straight from the URL — best-effort; a broken URL just hides it.
              <img src={iconLink} alt="" width={28} height={28} key={iconLink}
                style={{ borderRadius: 4, objectFit: "contain", flex: "0 0 28px" }}
                onError={(e) => (e.currentTarget.style.visibility = "hidden")} />
            )}
            <input type="url" inputMode="url" value={iconLink} onChange={(e) => setIconLink(e.target.value)} placeholder={t("cust.vendors.iconLinkPlaceholder")} />
          </div>
        </div>
      </div>
      <p className="muted" style={{ fontSize: 12, marginTop: 6 }}>{t("cust.vendors.linkHelp")}</p>
      <p className="muted" style={{ fontSize: 12, marginTop: 2 }}>{t("cust.vendors.iconLinkHelp")}</p>

      {/* Match conditions — identity */}
      <RowSection
        title={t("cust.vendors.matchTitle")}
        help={t("cust.vendors.matchHelp")}
        rows={matchRows}
        setRows={setMatchRows}
        showCategory={false}
        categories={categories}
        refs={refs}
        minRows={0}
      />

      {/* Category rules — refinement */}
      <RowSection
        title={t("cust.vendors.rulesTitle")}
        help={t("cust.vendors.rulesHelp")}
        rows={catRows}
        setRows={setCatRows}
        showCategory
        categories={categories}
        refs={refs}
        minRows={0}
      />

      <datalist id="plaid-primaries">{refs.plaidPrimaries.map((p) => <option key={p} value={p} />)}</datalist>
      <datalist id="plaid-detaileds">{refs.plaidDetaileds.map((p) => <option key={p} value={p} />)}</datalist>
      <datalist id="plaid-confidences">{refs.plaidConfidences.map((p) => <option key={p} value={p} />)}</datalist>

      {error && <div className="error">{error}</div>}

      <div className="row" style={{ gap: 8, marginTop: 18 }}>
        <button className="btn btn-primary" disabled={saving || !name.trim() || !defaultCat} onClick={save}>
          {saving ? t("common.saving") : t("common.save")}
        </button>
        <button className="btn btn-ghost" disabled={saving} onClick={onCancel}>
          {t("common.cancel")}
        </button>
      </div>
    </div>
  );
}

// One editable list of condition rows (Match or Category-rules). `showCategory`
// renders each row's category select (category rules) or hides it (match rows).
function RowSection({
  title,
  help,
  rows,
  setRows,
  showCategory,
  categories,
  refs,
  minRows,
}: {
  title: string;
  help: string;
  rows: RowForm[];
  setRows: React.Dispatch<React.SetStateAction<RowForm[]>>;
  showCategory: boolean;
  categories: string[];
  refs: Refs;
  minRows: number;
}) {
  const t = useT();
  const setRow = (key: string, patch: Partial<RowForm>) =>
    setRows((rs) => rs.map((r) => (r.key === key ? { ...r, ...patch } : r)));
  const removeRow = (key: string) => setRows((rs) => rs.filter((r) => r.key !== key));
  return (
    <div style={{ marginTop: 20 }}>
      <label style={{ marginBottom: 4 }}>{title}</label>
      <p className="muted" style={{ fontSize: 12, marginTop: 0 }}>{help}</p>
      {rows.map((r, i) => (
        <RowEditor
          key={r.key}
          row={r}
          index={i}
          showCategory={showCategory}
          canRemove={rows.length > minRows}
          categories={categories}
          refs={refs}
          onChange={(patch) => setRow(r.key, patch)}
          onRemove={() => removeRow(r.key)}
        />
      ))}
      <button type="button" className="btn btn-sm" onClick={() => setRows((rs) => [...rs, emptyRow()])}>
        + {showCategory ? t("cust.vendors.addRule") : t("cust.vendors.addMatch")}
      </button>
    </div>
  );
}

// One condition row (FR1 fields). `order` is implicit (array position). The
// category select shows only for category rules (showCategory).
function RowEditor({
  row,
  index,
  showCategory,
  canRemove,
  categories,
  refs,
  onChange,
  onRemove,
}: {
  row: RowForm;
  index: number;
  showCategory: boolean;
  canRemove: boolean;
  categories: string[];
  refs: Refs;
  onChange: (patch: Partial<RowForm>) => void;
  onRemove: () => void;
}) {
  const t = useT();
  return (
    <div className="card" style={{ background: "var(--bg-3)", padding: 14, marginBottom: 12 }}>
      <div className="row" style={{ justifyContent: "space-between", marginBottom: 8 }}>
        <strong style={{ fontSize: 13 }}>{t("cust.vendors.rowN", { n: index + 1 })}</strong>
        {canRemove && (
          <button type="button" className="btn btn-sm btn-ghost" onClick={onRemove}>
            {t("cust.vendors.removeRow")}
          </button>
        )}
      </div>
      <div className="field-grid">
        {/* transaction name */}
        <TextField
          label={t("cust.vendors.txnName")}
          op={row.nameOp}
          value={row.nameValue}
          onOp={(nameOp) => onChange({ nameOp })}
          onValue={(nameValue) => onChange({ nameValue })}
        />
        {/* merchant name */}
        <TextField
          label={t("cust.vendors.merchantName")}
          op={row.merchantOp}
          value={row.merchantValue}
          onOp={(merchantOp) => onChange({ merchantOp })}
          onValue={(merchantValue) => onChange({ merchantValue })}
        />
        {/* amount min/max (signed) */}
        <div>
          <label>{t("cust.vendors.amount")}</label>
          <div className="row" style={{ gap: 6 }}>
            <input type="number" step="0.01" placeholder={t("cust.vendors.min")} value={row.amountMin} onChange={(e) => onChange({ amountMin: e.target.value })} />
            <input type="number" step="0.01" placeholder={t("cust.vendors.max")} value={row.amountMax} onChange={(e) => onChange({ amountMax: e.target.value })} />
          </div>
        </div>
        {/* account */}
        <div>
          <label>{t("cust.vendors.account")}</label>
          <select value={row.accountId} onChange={(e) => onChange({ accountId: e.target.value })}>
            <option value="">{t("cust.vendors.anyOption")}</option>
            {refs.accounts.map((a) => (
              <option key={a.accountId} value={a.accountId}>
                {a.name}{a.subtype ? ` (${a.subtype})` : ""}
              </option>
            ))}
          </select>
        </div>
        {/* payment channel */}
        <div>
          <label>{t("cust.vendors.channel")}</label>
          <select value={row.paymentChannel} onChange={(e) => onChange({ paymentChannel: e.target.value })}>
            <option value="">{t("cust.vendors.anyOption")}</option>
            {CHANNELS.map((c) => (
              <option key={c} value={c}>{c}</option>
            ))}
          </select>
        </div>
        {/* plaid primary/detailed (datalists defined once at editor level) */}
        <div>
          <label>{t("cust.vendors.plaidPrimary")}</label>
          <input list="plaid-primaries" value={row.plaidPrimary} onChange={(e) => onChange({ plaidPrimary: e.target.value })} placeholder={t("cust.vendors.anyOption")} />
        </div>
        <div>
          <label>{t("cust.vendors.plaidDetailed")}</label>
          <input list="plaid-detaileds" value={row.plaidDetailed} onChange={(e) => onChange({ plaidDetailed: e.target.value })} placeholder={t("cust.vendors.anyOption")} />
        </div>
        {/* plaid confidence (VERY_HIGH…UNKNOWN) */}
        <div>
          <label>{t("cust.vendors.plaidConfidence")}</label>
          <input list="plaid-confidences" value={row.plaidConfidence} onChange={(e) => onChange({ plaidConfidence: e.target.value })} placeholder={t("cust.vendors.anyOption")} />
        </div>
        {/* per-row category (outcome) — category rules only */}
        {showCategory && (
          <div>
            <label>{t("cust.vendors.rowCategory")}</label>
            <CategorySelect value={row.categoryName} categories={categories} onChange={(categoryName) => onChange({ categoryName })} noneLabel={t("cust.vendors.rowNoCategory")} />
          </div>
        )}
      </div>
    </div>
  );
}

function TextField({
  label,
  op,
  value,
  onOp,
  onValue,
}: {
  label: string;
  op: string;
  value: string;
  onOp: (op: string) => void;
  onValue: (v: string) => void;
}) {
  const t = useT();
  return (
    <div>
      <label>{label}</label>
      <div className="row" style={{ gap: 6 }}>
        <select style={{ flex: "0 0 130px" }} value={op} onChange={(e) => onOp(e.target.value)}>
          {TEXT_OPS.map((o) => (
            <option key={o} value={o}>{t(`cust.vendors.op.${o}`)}</option>
          ))}
        </select>
        <input value={value} onChange={(e) => onValue(e.target.value)} placeholder={t("cust.vendors.valuePlaceholder")} />
      </div>
    </div>
  );
}

function CategorySelect({
  value,
  categories,
  onChange,
  noneLabel,
}: {
  value: string;
  categories: string[];
  onChange: (v: string) => void;
  noneLabel: string;
}) {
  return (
    <select value={value} onChange={(e) => onChange(e.target.value)}>
      <option value="">{noneLabel}</option>
      {categories.map((c) => (
        <option key={c} value={c}>{c}</option>
      ))}
    </select>
  );
}
