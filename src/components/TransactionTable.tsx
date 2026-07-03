import React from "react";
import { t, type Locale } from "@/lib/i18n";

export type Txn = {
  transaction_id: string;
  name: string;
  merchant_name: string | null;
  item_name?: string;
  account_name?: string;
  amount: number;
  currency_code: string | null;
  datetime: string;
  last_updated: string;
  predicted_category: string | null;
  pending: boolean;
  is_group?: boolean; // merge-group synthetic row (F8/FR3): collapses its legs
  leg_count?: number;
};

// label is an i18n key (see src/lib/i18n/en.ts "field.*"), translated at render.
type Field = [labelKey: string, key: keyof Txn | "amount" | "datetime" | "last_updated"];

const DEFAULT_FIELDS: Field[] = [
  ["field.name", "name"],
  ["field.merchant", "merchant_name"],
  ["field.category", "predicted_category"],
  ["field.amount", "amount"],
  ["field.date", "datetime"],
  ["field.lastUpdated", "last_updated"],
];

const groupBadge: React.CSSProperties = {
  marginLeft: 6,
  fontSize: 11,
  padding: "1px 6px",
  borderRadius: 10,
  background: "var(--bg-3)",
  border: "1px solid var(--border)",
  color: "var(--muted)",
};

function cell(row: Txn, key: string, locale: Locale): React.ReactNode {
  if (key === "amount") return `${row.currency_code ?? ""} ${row.amount}`.trim();
  if (key === "datetime") return new Date(row.datetime).toLocaleDateString("en-ZA", { timeZone: "UTC" });
  if (key === "last_updated") return new Date(row.last_updated).toLocaleString("en-ZA");
  if (key === "name" && row.is_group)
    return (
      <>
        {row.name}
        <span style={groupBadge} title={t(locale, "txn.groupTooltip", { n: row.leg_count ?? 0 })}>
          {t(locale, "txn.groupBadge", { n: row.leg_count ?? 0 })}
        </span>
      </>
    );
  const v = (row as Record<string, unknown>)[key];
  return v == null ? "" : String(v);
}

// locale is passed in (not read from context) because this component renders in
// both server (ItemDetail) and client (Budget) trees — a context hook can't do both.
export default function TransactionTable({
  transactions,
  fields = DEFAULT_FIELDS,
  locale,
}: {
  transactions: Txn[];
  fields?: Field[];
  locale: Locale;
}) {
  return (
    <table className="nested">
      <thead>
        <tr>
          {fields.map(([labelKey]) => (
            <th key={labelKey}>{t(locale, labelKey)}</th>
          ))}
        </tr>
      </thead>
      <tbody>
        {transactions.map((row) => (
          <tr key={row.transaction_id} className={row.pending ? "pending" : undefined}>
            {fields.map(([labelKey, key]) => (
              <td key={labelKey}>{cell(row, key, locale)}</td>
            ))}
          </tr>
        ))}
      </tbody>
    </table>
  );
}
