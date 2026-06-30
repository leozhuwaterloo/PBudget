"use client";
import React, { useState } from "react";
import TransactionTable, { type Txn } from "./TransactionTable";

type Account = {
  account_id: string;
  name: string;
  current: number | null;
  currency_code: string | null;
  last_updated: string;
  transactions: Txn[];
};

export default function ItemDetail({
  name,
  lastUpdated,
  accounts,
}: {
  name: string;
  lastUpdated: string;
  accounts: Account[];
}) {
  const [open, setOpen] = useState<Set<string>>(new Set());
  const toggle = (id: string) => {
    const next = new Set(open);
    next.has(id) ? next.delete(id) : next.add(id);
    setOpen(next);
  };

  return (
    <div>
      <h1>{name}</h1>
      <p className="muted">Updated {new Date(lastUpdated).toLocaleString("en-ZA")}</p>
      <div className="card" style={{ padding: 0 }}>
        <table>
          <thead>
            <tr>
              <th>Account</th>
              <th>Current</th>
              <th>Transactions</th>
              <th>Last updated</th>
            </tr>
          </thead>
          <tbody>
            {accounts.map((a) => (
              <React.Fragment key={a.account_id}>
                <tr className="clickable" onClick={() => toggle(a.account_id)}>
                  <td>{open.has(a.account_id) ? "▾" : "▸"} {a.name}</td>
                  <td>{a.currency_code ?? ""} {a.current ?? ""}</td>
                  <td>{a.transactions.length}</td>
                  <td>{new Date(a.last_updated).toLocaleString("en-ZA")}</td>
                </tr>
                {open.has(a.account_id) && a.transactions.length > 0 && (
                  <tr>
                    <td colSpan={4} style={{ padding: 0 }}>
                      <TransactionTable transactions={a.transactions} />
                    </td>
                  </tr>
                )}
              </React.Fragment>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
