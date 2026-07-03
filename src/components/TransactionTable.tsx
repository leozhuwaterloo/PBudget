import React from "react";

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

type Field = [label: string, key: keyof Txn | "amount" | "datetime" | "last_updated"];

const DEFAULT_FIELDS: Field[] = [
  ["Transaction Name", "name"],
  ["Merchant Name", "merchant_name"],
  ["Category", "predicted_category"],
  ["Amount", "amount"],
  ["Date", "datetime"],
  ["Last Updated", "last_updated"],
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

function cell(t: Txn, key: string): React.ReactNode {
  if (key === "amount") return `${t.currency_code ?? ""} ${t.amount}`.trim();
  if (key === "datetime") return new Date(t.datetime).toLocaleDateString("en-ZA", { timeZone: "UTC" });
  if (key === "last_updated") return new Date(t.last_updated).toLocaleString("en-ZA");
  if (key === "name" && t.is_group)
    return (
      <>
        {t.name}
        <span style={groupBadge} title={`Merged group of ${t.leg_count} transactions`}>
          group · {t.leg_count}
        </span>
      </>
    );
  const v = (t as Record<string, unknown>)[key];
  return v == null ? "" : String(v);
}

export default function TransactionTable({
  transactions,
  fields = DEFAULT_FIELDS,
}: {
  transactions: Txn[];
  fields?: Field[];
}) {
  return (
    <table className="nested">
      <thead>
        <tr>
          {fields.map(([label]) => (
            <th key={label}>{label}</th>
          ))}
        </tr>
      </thead>
      <tbody>
        {transactions.map((t) => (
          <tr key={t.transaction_id} className={t.pending ? "pending" : undefined}>
            {fields.map(([label, key]) => (
              <td key={label}>{cell(t, key)}</td>
            ))}
          </tr>
        ))}
      </tbody>
    </table>
  );
}
