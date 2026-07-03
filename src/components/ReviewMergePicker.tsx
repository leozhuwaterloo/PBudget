"use client";
import { useEffect, useState } from "react";

// N-way merge picker (FR3/FR4). Lists the user's posted, ungrouped transactions
// from GET /api/merge/candidates (flagged AND unflagged — pending rows and
// existing legs already excluded server-side); pick N≥2, optional title, submit
// to POST /api/merge. Title (which /api/merge ignores) is applied via PATCH.

type Candidate = {
  id: string;
  name: string;
  merchantName: string | null;
  vendorName: string;
  amount: number | null;
  currency: string | null;
  date: string;
};

const money = (amount: number | null, currency: string | null) =>
  amount == null ? "—" : `${currency ? currency + " " : ""}${(-amount).toFixed(2)}`;

export default function ReviewMergePicker({
  seedId,
  onClose,
  onMerged,
}: {
  seedId?: string;
  onClose: () => void;
  onMerged: () => void;
}) {
  const [candidates, setCandidates] = useState<Candidate[]>([]);
  const [selected, setSelected] = useState<Set<string>>(new Set(seedId ? [seedId] : []));
  const [title, setTitle] = useState("");
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  useEffect(() => {
    (async () => {
      try {
        const res = await fetch("/api/merge/candidates");
        const data = await res.json().catch(() => ({}));
        if (!res.ok) throw new Error(data.error || "Failed to load candidates");
        setCandidates(data.candidates);
      } catch (e: any) {
        setError(e.message);
      } finally {
        setLoading(false);
      }
    })();
  }, []);

  const toggle = (id: string) =>
    setSelected((s) => {
      const n = new Set(s);
      n.has(id) ? n.delete(id) : n.add(id);
      return n;
    });

  const submit = async () => {
    setBusy(true);
    setError("");
    try {
      const res = await fetch("/api/merge", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ transactionIds: [...selected] }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data.error || "Merge failed");
      const t = title.trim();
      if (t) {
        await fetch(`/api/merge/${data.group.id}`, {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ title: t }),
        });
      }
      onMerged();
    } catch (e: any) {
      setError(e.message);
      setBusy(false);
    }
  };

  return (
    <div
      style={{
        position: "fixed",
        inset: 0,
        background: "rgba(0,0,0,0.6)",
        display: "flex",
        alignItems: "flex-start",
        justifyContent: "center",
        padding: "40px 16px",
        overflow: "auto",
        zIndex: 50,
      }}
      onClick={onClose}
    >
      <div className="card" style={{ maxWidth: 640, width: "100%", margin: 0 }} onClick={(ev) => ev.stopPropagation()}>
        <div className="card-header">Merge transactions</div>
        <p className="muted" style={{ marginTop: 0 }}>
          Pick two or more posted transactions to merge into one group.
        </p>

        <input placeholder="Optional group title" value={title} onChange={(e) => setTitle(e.target.value)} />

        <div
          style={{
            maxHeight: 340,
            overflow: "auto",
            border: "1px solid var(--border)",
            borderRadius: 6,
            margin: "12px 0",
          }}
        >
          {loading ? (
            <p className="muted" style={{ padding: 12 }}>
              Loading candidates…
            </p>
          ) : candidates.length === 0 ? (
            <p className="muted" style={{ padding: 12 }}>
              No transactions available to merge.
            </p>
          ) : (
            candidates.map((c) => (
              <label
                key={c.id}
                style={{
                  display: "flex",
                  alignItems: "center",
                  gap: 8,
                  padding: "6px 10px",
                  margin: 0,
                  borderBottom: "1px solid var(--border)",
                  cursor: "pointer",
                }}
              >
                <input
                  type="checkbox"
                  style={{ width: "auto" }}
                  checked={selected.has(c.id)}
                  onChange={() => toggle(c.id)}
                />
                <span style={{ flex: 1 }}>
                  {c.vendorName}
                  {c.name && c.name.toLowerCase() !== c.vendorName ? (
                    <span className="muted"> · {c.name}</span>
                  ) : null}
                </span>
                <span>{money(c.amount, c.currency)}</span>
                <span className="muted" style={{ width: 90, textAlign: "right" }}>
                  {new Date(c.date).toLocaleDateString()}
                </span>
              </label>
            ))
          )}
        </div>

        {error && <div className="error">{error}</div>}

        <div className="row wrap">
          <button className="btn btn-primary" disabled={busy || selected.size < 2} onClick={submit}>
            Merge {selected.size} selected
          </button>
          <button className="btn btn-ghost" disabled={busy} onClick={onClose}>
            Cancel
          </button>
        </div>
      </div>
    </div>
  );
}
