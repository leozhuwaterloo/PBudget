"use client";
import { useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import PlaidOpener from "./PlaidOpener";

type Item = { itemId: string; name: string; lastUpdated: string; accounts: number };

async function postJson(url: string, body?: unknown) {
  const res = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: body ? JSON.stringify(body) : undefined,
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.error || "Request failed");
  return data;
}

export default function Dashboard({ items, subscribed }: { items: Item[]; subscribed: boolean }) {
  const router = useRouter();
  const [connectToken, setConnectToken] = useState<string | null>(null);
  const [reauth, setReauth] = useState<{ itemId: string; token: string } | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  const run = async (fn: () => Promise<void>) => {
    setBusy(true);
    setError("");
    try {
      await fn();
    } catch (e: any) {
      setError(e.message);
    } finally {
      setBusy(false);
    }
  };

  const subscribe = () =>
    run(async () => {
      const { url } = await postJson("/api/stripe/checkout");
      window.location.href = url;
    });

  const startConnect = () =>
    run(async () => {
      const { link_token } = await postJson("/api/plaid/link-token");
      setConnectToken(link_token);
    });

  const startReauth = (itemId: string) =>
    run(async () => {
      const { link_token } = await postJson("/api/plaid/link-token-update", { item_id: itemId });
      setReauth({ itemId, token: link_token });
    });

  const sync = (itemId: string) =>
    run(async () => {
      await postJson("/api/plaid/item/sync", { item_id: itemId });
      router.refresh();
    });

  return (
    <div>
      <h1>Your banks</h1>

      {!subscribed && (
        <div className="banner">
          <strong>Start your subscription</strong> — $1 per managed account / month. You need an
          active subscription to connect and sync accounts.
          <div style={{ marginTop: 10 }}>
            <button className="btn btn-primary" onClick={subscribe} disabled={busy}>
              Subscribe
            </button>
          </div>
        </div>
      )}

      {error && <div className="error">{error}</div>}

      {items.length === 0 ? (
        <p className="muted">No banks connected yet.</p>
      ) : (
        <div className="card" style={{ padding: 0 }}>
          <table>
            <thead>
              <tr>
                <th>Bank</th>
                <th>Accounts</th>
                <th>Last updated</th>
                <th>Actions</th>
              </tr>
            </thead>
            <tbody>
              {items.map((it) => (
                <tr key={it.itemId}>
                  <td>
                    <Link href={`/item/${it.itemId}`}>{it.name}</Link>
                  </td>
                  <td>{it.accounts}</td>
                  <td>{new Date(it.lastUpdated).toLocaleString()}</td>
                  <td>
                    <div className="row wrap">
                      <button
                        className="btn btn-sm"
                        disabled={busy || !subscribed}
                        onClick={() => sync(it.itemId)}
                      >
                        Sync
                      </button>
                      <button
                        className="btn btn-sm"
                        disabled={busy || !subscribed}
                        onClick={() => startReauth(it.itemId)}
                      >
                        Re-auth
                      </button>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      <div className="row wrap" style={{ marginTop: 16 }}>
        <button className="btn btn-primary" onClick={startConnect} disabled={busy || !subscribed}>
          Connect a bank account
        </button>
        <Link className="btn btn-success" href="/budget">
          View Budget Planning
        </Link>
      </div>

      {connectToken && (
        <PlaidOpener
          token={connectToken}
          onExit={() => setConnectToken(null)}
          onSuccess={(publicToken) =>
            run(async () => {
              setConnectToken(null);
              await postJson("/api/plaid/item/update", { public_token: publicToken });
              router.refresh();
            })
          }
        />
      )}

      {reauth && (
        <PlaidOpener
          token={reauth.token}
          onExit={() => setReauth(null)}
          onSuccess={() =>
            run(async () => {
              const itemId = reauth.itemId;
              setReauth(null);
              await postJson("/api/plaid/item/sync", { item_id: itemId });
              router.refresh();
            })
          }
        />
      )}
    </div>
  );
}
