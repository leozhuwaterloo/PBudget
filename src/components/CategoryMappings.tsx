"use client";
import { useEffect, useState } from "react";
import { useT } from "@/lib/i18n/context";

type Row = { plaidPrimary: string; default: string; category: string; overridden: boolean };

// FR6 UI: list the Plaid primaries the user has transactions for and let them
// remap any to a free-text category (existing categories suggested via datalist).
// Saving PUTs the override and updates in place; "Reset" clears it. Mapping is
// applied at read time, so /report and /budget move retroactively — no rewrite.
export default function CategoryMappings() {
  const t = useT();
  const [rows, setRows] = useState<Row[] | null>(null);
  const [categories, setCategories] = useState<string[]>([]);
  const [drafts, setDrafts] = useState<Record<string, string>>({});
  const [saving, setSaving] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    (async () => {
      const res = await fetch("/api/categories/mapping");
      if (!res.ok) return setError(t("catmap.loadFailed"));
      const data = await res.json();
      setRows(data.mappings);
      setCategories(data.categories);
      setDrafts(Object.fromEntries(data.mappings.map((r: Row) => [r.plaidPrimary, r.category])));
    })();
  }, []);

  async function save(primary: string, categoryName: string) {
    setSaving(primary);
    setError(null);
    const res = await fetch("/api/categories/mapping", {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ plaidPrimary: primary, categoryName }),
    });
    setSaving(null);
    if (!res.ok) return setError(t("catmap.saveFailed"));
    const updated: Row = await res.json();
    setRows((rs) => rs!.map((r) => (r.plaidPrimary === primary ? updated : r)));
    setDrafts((d) => ({ ...d, [primary]: updated.category }));
    if (updated.overridden && !categories.includes(updated.category)) {
      setCategories((c) => [...c, updated.category].sort((a, b) => a.localeCompare(b)));
    }
  }

  if (!rows) return <p className="muted">{error ?? t("common.loading")}</p>;

  return (
    <div>
      <h1>{t("catmap.title")}</h1>
      <p className="muted" style={{ marginBottom: 16 }}>
        {t("catmap.help")}
      </p>
      {error && <div className="error">{error}</div>}

      <datalist id="category-suggestions">
        {categories.map((c) => (
          <option key={c} value={c} />
        ))}
      </datalist>

      <div className="card" style={{ padding: 0 }}>
        <table>
          <thead>
            <tr>
              <th>{t("catmap.colPlaid")}</th>
              <th>{t("catmap.colYours")}</th>
              <th></th>
            </tr>
          </thead>
          <tbody>
            {rows.map((r) => {
              const draft = drafts[r.plaidPrimary] ?? "";
              const busy = saving === r.plaidPrimary;
              const dirty = draft.trim() !== r.category;
              return (
                <tr key={r.plaidPrimary}>
                  <td>
                    {r.default}
                    {r.overridden && <span className="muted"> · {t("catmap.overridden")}</span>}
                  </td>
                  <td>
                    <input
                      list="category-suggestions"
                      value={draft}
                      placeholder={r.default}
                      disabled={busy}
                      onChange={(e) =>
                        setDrafts((d) => ({ ...d, [r.plaidPrimary]: e.target.value }))
                      }
                    />
                  </td>
                  <td>
                    <div className="row">
                      <button
                        className="btn btn-sm btn-primary"
                        disabled={busy || !dirty}
                        onClick={() => save(r.plaidPrimary, draft)}
                      >
                        {busy ? t("common.saving") : t("common.save")}
                      </button>
                      {r.overridden && (
                        <button
                          className="btn btn-sm btn-ghost"
                          disabled={busy}
                          onClick={() => save(r.plaidPrimary, "")}
                        >
                          {t("common.reset")}
                        </button>
                      )}
                    </div>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </div>
  );
}
