import TransactionTable, { type Txn } from "./TransactionTable";

type Account = {
  account_id: string;
  name: string;
  current: number | null;
  currency_code: string | null;
  last_updated: string;
  transaction_count: number;
};

// Merge groups span accounts (an e-transfer pair lives in two), so transactions
// render as ONE item-wide table fed by effectiveTransactions (F8/FR3) rather than
// per-account sub-tables — otherwise a cross-account group has no single home.
export default function ItemDetail({
  name,
  lastUpdated,
  accounts,
  transactions,
}: {
  name: string;
  lastUpdated: string;
  accounts: Account[];
  transactions: Txn[];
}) {
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
              <tr key={a.account_id}>
                <td>{a.name}</td>
                <td>{a.currency_code ?? ""} {a.current ?? ""}</td>
                <td>{a.transaction_count}</td>
                <td>{new Date(a.last_updated).toLocaleString("en-ZA")}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {transactions.length > 0 && (
        <div className="card" style={{ padding: 0 }}>
          <TransactionTable transactions={transactions} />
        </div>
      )}
    </div>
  );
}
