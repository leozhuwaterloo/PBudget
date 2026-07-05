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
  paymentChannel?: string | null;
  plaidPrimary?: string | null;
  plaidDetailed?: string | null;
};

export function Chip({ tone = "field", children }: { tone?: "field" | "cat"; children: React.ReactNode }) {
  const cat = tone === "cat";
  return (
    <span
      style={{
        display: "inline-block",
        fontSize: 12,
        padding: "2px 8px",
        borderRadius: 999,
        background: cat ? "rgba(21,104,74,0.12)" : "var(--bg-3)",
        color: cat ? "var(--primary)" : "var(--muted)",
        border: `1px solid ${cat ? "rgba(21,104,74,0.25)" : "var(--border)"}`,
        whiteSpace: "nowrap",
      }}
    >
      {children}
    </span>
  );
}

// Human summary of a row's matching fields (excludes its category outcome).
function fieldChips(c: AnyCondition, t: (k: string, p?: Record<string, string | number>) => string, accountName: (id: string) => string): string[] {
  const out: string[] = [];
  const opLabel = (op?: string | null) => (op ? t(`cust.vendors.op.${op}`) : "");
  if (c.nameOp && c.nameValue) out.push(`${t("cust.vendors.txnName")} ${opLabel(c.nameOp)} "${c.nameValue}"`);
  if (c.merchantOp && c.merchantValue) out.push(`${t("cust.vendors.merchantName")} ${opLabel(c.merchantOp)} "${c.merchantValue}"`);
  if (c.amountMin != null && c.amountMax != null) out.push(`${t("cust.vendors.amount")} ${c.amountMin}–${c.amountMax}`);
  else if (c.amountMin != null) out.push(`${t("cust.vendors.amount")} ≥ ${c.amountMin}`);
  else if (c.amountMax != null) out.push(`${t("cust.vendors.amount")} ≤ ${c.amountMax}`);
  if (c.accountId) out.push(`${t("cust.vendors.account")}: ${accountName(c.accountId)}`);
  if (c.paymentChannel) out.push(`${t("cust.vendors.channel")}: ${c.paymentChannel}`);
  if (c.plaidPrimary) out.push(`${t("cust.vendors.plaidPrimary")}: ${c.plaidPrimary}`);
  if (c.plaidDetailed) out.push(`${t("cust.vendors.plaidDetailed")}: ${c.plaidDetailed}`);
  return out;
}

// One condition row rendered as field chips + its category chip.
export function RowSummary({ condition, accountName }: { condition: AnyCondition; accountName?: (id: string) => string }) {
  const t = useT();
  const chips = fieldChips(condition, t, accountName ?? ((id) => id));
  return (
    <div className="row wrap" style={{ gap: 6, margin: "6px 0" }}>
      {chips.length === 0 && <span className="muted" style={{ fontSize: 12 }}>{t("cust.vendors.emptyRow")}</span>}
      {chips.map((c, i) => (
        <Chip key={i}>{c}</Chip>
      ))}
      <span style={{ color: "var(--muted)" }}>→</span>
      <Chip tone="cat">{condition.categoryName || t("cust.vendors.rowNoCategory")}</Chip>
    </div>
  );
}
