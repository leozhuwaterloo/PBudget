"use client";
import React, { useMemo, useState } from "react";
import TransactionTable, { type Txn } from "./TransactionTable";
import { useT, useLocale } from "@/lib/i18n/context";

// Categories excluded from the monthly spend total (income / internal transfers).
// Ported from the old Portfolio budget view's TOTAL_IGNORE_CATEGORIES; names match the humanized
// Plaid personal_finance_category primaries we store. Adjust to taste.
const IGNORE = new Set(["Income", "Transfer In", "Transfer Out"]);

const monthOf = (iso: string) =>
  new Date(iso).toLocaleString("default", { month: "long", year: "numeric", timeZone: "UTC" });

type Cat = { name: string; budget: number };

export default function Budget({
  transactions,
  categories,
}: {
  transactions: Txn[];
  categories: Cat[];
}) {
  const t = useT();
  const locale = useLocale();
  const [budgets, setBudgets] = useState<Record<string, number>>(
    Object.fromEntries(categories.map((c) => [c.name, c.budget]))
  );
  const [openMonths, setOpenMonths] = useState<Set<string>>(new Set());
  const [openCats, setOpenCats] = useState<Set<string>>(new Set());

  const catNames = useMemo(
    () => categories.map((c) => c.name).sort((a, b) => a.localeCompare(b, "en", { sensitivity: "base" })),
    [categories]
  );

  const { months, monthTotal, byMonthCat, txById } = useMemo(() => {
    const txById: Record<string, Txn> = {};
    for (const t of transactions) txById[t.transaction_id] = t;

    const monthSet = new Set<string>();
    const monthTotal: Record<string, number> = {};
    const byMonthCat: Record<string, Record<string, { total: number; currency: string | null; ids: string[] }>> = {};

    for (const t of transactions) {
      if (!t.datetime) continue;
      const m = monthOf(t.datetime);
      monthSet.add(m);
      const cat = t.predicted_category;
      if (!cat) continue;
      if (!IGNORE.has(cat)) monthTotal[m] = (monthTotal[m] ?? 0) + t.amount;
      (byMonthCat[m] ??= {});
      (byMonthCat[m][cat] ??= { total: 0, currency: t.currency_code, ids: [] });
      byMonthCat[m][cat].total += t.amount;
      byMonthCat[m][cat].ids.push(t.transaction_id);
    }

    // sort each category's transactions oldest-first (as the original did)
    for (const m of Object.keys(byMonthCat)) {
      for (const c of Object.keys(byMonthCat[m])) {
        byMonthCat[m][c].ids.sort(
          (a, b) => new Date(txById[a].datetime).getTime() - new Date(txById[b].datetime).getTime()
        );
      }
    }

    const months = Array.from(monthSet).sort((a, b) => new Date(a).getTime() - new Date(b).getTime());
    return { months, monthTotal, byMonthCat, txById };
  }, [transactions]);

  const totalBudget = useMemo(
    () => catNames.reduce((sum, n) => (IGNORE.has(n) ? sum : sum + (budgets[n] || 0)), 0),
    [catNames, budgets]
  );

  const toggle = (set: Set<string>, key: string, setter: (s: Set<string>) => void) => {
    const next = new Set(set);
    next.has(key) ? next.delete(key) : next.add(key);
    setter(next);
  };

  const saveBudget = async (name: string, value: number) => {
    setBudgets((b) => ({ ...b, [name]: value }));
    await fetch("/api/plaid/categories", {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ name, budget: value }),
    }).catch(() => {});
  };

  return (
    <div>
      <h1>{t("budget.title")}</h1>
      {transactions.length === 0 && (
        <p className="muted">{t("budget.empty")}</p>
      )}
      <div className="card" style={{ padding: 0 }}>
        <table>
          <thead>
            <tr>
              <th>{t("budget.colMonth")}</th>
              <th>{t("budget.colTotal")}</th>
            </tr>
          </thead>
          <tbody>
            {months.map((m) => {
              if (!byMonthCat[m]) return null;
              const total = monthTotal[m] ?? 0;
              const pct = totalBudget ? (total * 100) / totalBudget : 0;
              const open = openMonths.has(m);
              return (
                <React.Fragment key={m}>
                  <tr className="clickable" onClick={() => toggle(openMonths, m, setOpenMonths)}>
                    <td><strong>{open ? "▾" : "▸"} {m}</strong></td>
                    <td>
                      {total.toFixed(2)} / {totalBudget.toFixed(2)}{" "}
                      {totalBudget ? `(${pct.toFixed(2)}%)` : ""}
                    </td>
                  </tr>
                  {open && (
                    <tr>
                      <td colSpan={2} style={{ padding: 0 }}>
                        <table className="nested">
                          <thead>
                            <tr>
                              <th>{t("budget.colCategory")}</th>
                              <th>{t("budget.colSpent")}</th>
                              <th>{t("budget.colBudget")}</th>
                              <th>{t("budget.colUsage")}</th>
                              <th>{t("budget.colTransactions")}</th>
                            </tr>
                          </thead>
                          <tbody>
                            {catNames.map((name) => {
                              const info = byMonthCat[m][name];
                              if (!info) return null;
                              const spent = info.total || 0;
                              const budget = budgets[name] || 0;
                              const usage = budget ? (spent * 100) / budget : 0;
                              const key = `${m}|${name}`;
                              const catOpen = openCats.has(key);
                              const cls = spent > 0 && usage > 100 ? "bg-warning" : "bg-success";
                              return (
                                <React.Fragment key={name}>
                                  <tr
                                    className={`clickable ${cls}`}
                                    onClick={() => toggle(openCats, key, setOpenCats)}
                                  >
                                    <td>{catOpen ? "▾" : "▸"} {name}</td>
                                    <td>{info.currency ?? ""} {spent.toFixed(2)}</td>
                                    <td onClick={(e) => e.stopPropagation()}>
                                      <input
                                        className="budget"
                                        type="number"
                                        min={0}
                                        step="0.01"
                                        defaultValue={budget}
                                        onBlur={(e) => {
                                          const v = Number(e.target.value);
                                          if (Number.isFinite(v) && v >= 0 && v !== budget) saveBudget(name, v);
                                        }}
                                      />
                                    </td>
                                    <td>{budget ? `${usage.toFixed(2)}%` : t("budget.na")}</td>
                                    <td>{info.ids.length}</td>
                                  </tr>
                                  {catOpen && (
                                    <tr>
                                      <td colSpan={5} style={{ padding: 0 }}>
                                        <TransactionTable
                                          locale={locale}
                                          transactions={info.ids.map((id) => txById[id])}
                                          fields={[
                                            ["field.name", "name"],
                                            ["field.merchant", "merchant_name"],
                                            ["field.bank", "item_name"],
                                            ["field.account", "account_name"],
                                            ["field.amount", "amount"],
                                            ["field.date", "datetime"],
                                          ]}
                                        />
                                      </td>
                                    </tr>
                                  )}
                                </React.Fragment>
                              );
                            })}
                          </tbody>
                        </table>
                      </td>
                    </tr>
                  )}
                </React.Fragment>
              );
            })}
          </tbody>
        </table>
      </div>
    </div>
  );
}
