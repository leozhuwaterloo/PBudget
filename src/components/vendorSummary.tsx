"use client";
import React from "react";
import { useT } from "@/lib/i18n/context";

// A condition loose enough for both the /api/vendors serialization and the
// catalog entry shape (catalog rows omit accountId; fields are optional).
export type AnyCondition = {
  categoryName?: string | null;
  nameOp?: string | null;
  nameValue?: string | null;
  merchantOp?: string | null;
  merchantValue?: string | null;
  amountMin?: number | null;
  amountMax?: number | null;
  accountId?: string | null;
  daysOfMonth?: number[] | null;
  dayOfMonth?: number | null; // legacy single value (still rendered for old rows)
  paymentChannel?: string | null;
  plaidPrimary?: string | null;
  plaidDetailed?: string | null;
  plaidConfidence?: string | null;
};

// Per-field-type chip hue so each filter reads at a glance. Hue-based (translucent
// bg + saturated text) so both light and dark themes stay legible. "cat"/"field"
// keep their existing looks (category outcome / neutral fallback).
const CHIP_HUE: Record<string, number> = {
  name: 32, // transaction name → orange
  merchant: 145, // merchant name → green
  amount: 212, // amount → blue
  account: 268, // account → purple
  dayOfMonth: 12, // day of month → red-orange
  channel: 190, // payment channel → cyan
  plaidPrimary: 248, // Plaid primary → indigo
  plaidDetailed: 322, // Plaid detailed → pink
  plaidConfidence: 88, // Plaid confidence → lime
};

// A day-of-month filter value as a label: >0 → the plain day; 0 → "Last day"; -n →
// "Last day − n". Shared by the summary chip and the editor dropdown so both read
// the encoding the same way (see match.ts targetDayOfMonth).
export function domLabel(v: number, t: (k: string, p?: Record<string, string | number>) => string): string {
  if (v > 0) return String(v);
  if (v === 0) return t("cust.vendors.dom.last");
  return t("cust.vendors.dom.lastMinus", { n: -v });
}

export function Chip({ tone = "field", children }: { tone?: string; children: React.ReactNode }) {
  const base: React.CSSProperties = {
    display: "inline-block",
    fontSize: 12,
    padding: "2px 8px",
    borderRadius: 999,
    whiteSpace: "nowrap",
  };
  if (tone === "cat")
    return <span style={{ ...base, background: "rgba(21,104,74,0.12)", color: "var(--primary)", border: "1px solid rgba(21,104,74,0.25)" }}>{children}</span>;
  const h = CHIP_HUE[tone];
  if (h == null)
    return <span style={{ ...base, background: "var(--bg-3)", color: "var(--muted)", border: "1px solid var(--border)" }}>{children}</span>;
  return (
    <span style={{ ...base, background: `hsl(${h} 65% 50% / 0.15)`, color: `hsl(${h} 60% 46%)`, border: `1px solid hsl(${h} 55% 48% / 0.35)` }}>
      {children}
    </span>
  );
}

// Human summary of a row's matching fields (excludes its category outcome). Each
// chip carries its field `tone` so Chip can color it by type.
type FieldChip = { tone: string; text: string };
function fieldChips(c: AnyCondition, t: (k: string, p?: Record<string, string | number>) => string, accountName: (id: string) => string): FieldChip[] {
  const out: FieldChip[] = [];
  const opLabel = (op?: string | null) => (op ? t(`cust.vendors.op.${op}`) : "");
  if (c.nameOp && c.nameValue) out.push({ tone: "name", text: `${t("cust.vendors.txnName")} ${opLabel(c.nameOp)} "${c.nameValue}"` });
  if (c.merchantOp && c.merchantValue) out.push({ tone: "merchant", text: `${t("cust.vendors.merchantName")} ${opLabel(c.merchantOp)} "${c.merchantValue}"` });
  if (c.amountMin != null && c.amountMax != null) out.push({ tone: "amount", text: `${t("cust.vendors.amount")} ${c.amountMin}–${c.amountMax}` });
  else if (c.amountMin != null) out.push({ tone: "amount", text: `${t("cust.vendors.amount")} ≥ ${c.amountMin}` });
  else if (c.amountMax != null) out.push({ tone: "amount", text: `${t("cust.vendors.amount")} ≤ ${c.amountMax}` });
  if (c.accountId) out.push({ tone: "account", text: `${t("cust.vendors.account")}: ${accountName(c.accountId)}` });
  const domDays = c.daysOfMonth?.length ? c.daysOfMonth : c.dayOfMonth != null ? [c.dayOfMonth] : [];
  if (domDays.length) out.push({ tone: "dayOfMonth", text: `${t("cust.vendors.dayOfMonth")}: ${domDays.map((v) => domLabel(v, t)).join(", ")}` });
  if (c.paymentChannel) out.push({ tone: "channel", text: `${t("cust.vendors.channel")}: ${c.paymentChannel}` });
  if (c.plaidPrimary) out.push({ tone: "plaidPrimary", text: `${t("cust.vendors.plaidPrimary")}: ${c.plaidPrimary}` });
  if (c.plaidDetailed) out.push({ tone: "plaidDetailed", text: `${t("cust.vendors.plaidDetailed")}: ${c.plaidDetailed}` });
  if (c.plaidConfidence) out.push({ tone: "plaidConfidence", text: `${t("cust.vendors.plaidConfidence")}: ${c.plaidConfidence}` });
  return out;
}

// One condition row as field chips. A category rule (has categoryName) also shows
// its "→ category" outcome; a match condition (no categoryName) shows just the
// fields — it decides identity, not category.
export function RowSummary({ condition, accountName }: { condition: AnyCondition; accountName?: (id: string) => string }) {
  const t = useT();
  const chips = fieldChips(condition, t, accountName ?? ((id) => id));
  return (
    <div className="row wrap" style={{ gap: 6, margin: "6px 0" }}>
      {chips.length === 0 && <span className="muted" style={{ fontSize: 12 }}>{t("cust.vendors.emptyRow")}</span>}
      {chips.map((c, i) => (
        <Chip key={i} tone={c.tone}>{c.text}</Chip>
      ))}
      {condition.categoryName && (
        <>
          <span style={{ color: "var(--muted)" }}>→</span>
          <Chip tone="cat">{condition.categoryName}</Chip>
        </>
      )}
    </div>
  );
}
