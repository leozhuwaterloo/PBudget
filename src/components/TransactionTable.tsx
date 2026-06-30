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

function cell(t: Txn, key: string): React.ReactNode {
  if (key === "amount") return `${t.currency_code ?? ""} ${t.amount}`.trim();
  if (key === "datetime") return new Date(t.datetime).toLocaleDateString("en-ZA", { timeZone: "UTC" });
  if (key === "last_updated") return new Date(t.last_updated).toLocaleString("en-ZA");
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
