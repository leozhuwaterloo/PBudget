"use client";
import React, { useEffect, useState } from "react";
import { useT } from "@/lib/i18n/context";

type Cat = { id: string; name: string; budget: number; excludeFromTotals: boolean };

const byName = (a: Cat, b: Cat) => a.name.localeCompare(b.name, "en", { sensitivity: "base" });

// FR4 categories & budgets UI over the F6 API (GET/POST/PATCH/DELETE /api/categories).
// Rename cascades server-side to referencing rows; `onChanged` lets the parent
// refresh the mappings section so a cascaded rename shows up there immediately.
export default function CategoriesEditor({ onChanged }: { onChanged?: () => void }) {
  const t = useT();
  const [cats, setCats] = useState<Cat[] | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [newName, setNewName] = useState("");
  const [createError, setCreateError] = useState<string | null>(null);
  const [creating, setCreating] = useState(false);
  const [rowError, setRowError] = useState<Record<string, string>>({});

  useEffect(() => {
    (async () => {
      const res = await fetch("/api/categories");
      if (!res.ok) return setLoadError(t("cust.cat.loadFailed"));
      setCats((await res.json()).categories);
    })();
  }, []);

  const setRowErr = (id: string, msg: string | null) =>
    setRowError((e) => {
      const n = { ...e };
      if (msg) n[id] = msg;
      else delete n[id];
      return n;
    });

  // PATCH one field; throws the API's error message so callers surface it inline.
  async function patch(id: string, body: Partial<Cat>): Promise<Cat> {
    const res = await fetch("/api/categories", {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ id, ...body }),
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(data.error ?? t("common.genericError"));
    return data as Cat;
  }

  async function create() {
    const name = newName.trim();
    if (!name) return;
    setCreating(true);
    setCreateError(null);
    const res = await fetch("/api/categories", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ name }),
    });
    setCreating(false);
    const data = await res.json().catch(() => ({}));
    if (!res.ok) return setCreateError(data.error ?? t("cust.cat.createFailed"));
    setCats((c) => [...(c ?? []), data].sort(byName));
    setNewName("");
    onChanged?.();
  }

  async function rename(id: string, raw: string) {
    const cur = cats?.find((c) => c.id === id);
    if (!cur) return;
    const name = raw.trim();
    if (!name || name === cur.name) return; // no-op blur
    setRowErr(id, null);
    try {
      const updated = await patch(id, { name });
      setCats((c) => c!.map((x) => (x.id === id ? updated : x)).sort(byName));
      onChanged?.();
    } catch (e) {
      setRowErr(id, (e as Error).message);
    }
  }

  async function saveBudget(id: string, budget: number) {
    setRowErr(id, null);
    try {
      const updated = await patch(id, { budget });
      setCats((c) => c!.map((x) => (x.id === id ? updated : x)));
    } catch (e) {
      setRowErr(id, (e as Error).message);
    }
  }

  async function toggleExclude(id: string, excludeFromTotals: boolean) {
    setRowErr(id, null);
    try {
      const updated = await patch(id, { excludeFromTotals });
      setCats((c) => c!.map((x) => (x.id === id ? updated : x)));
    } catch (e) {
      setRowErr(id, (e as Error).message);
    }
  }

  async function del(id: string) {
    const cur = cats?.find((c) => c.id === id);
    if (!cur) return;
    if (!window.confirm(t("cust.cat.confirmDelete", { name: cur.name }))) return;
    setRowErr(id, null);
    const res = await fetch("/api/categories", {
      method: "DELETE",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ id }),
    });
    if (!res.ok) {
      const data = await res.json().catch(() => ({}));
      return setRowErr(id, data.error ?? t("cust.cat.deleteFailed"));
    }
    setCats((c) => c!.filter((x) => x.id !== id));
    onChanged?.();
  }

  if (!cats) return <p className="muted">{loadError ?? t("common.loading")}</p>;

  return (
    <div>
      <p className="muted" style={{ marginBottom: 16 }}>
        {t("cust.cat.help")}
      </p>

      <div className="card" style={{ padding: 0 }}>
        <table>
          <thead>
            <tr>
              <th>{t("cust.cat.colName")}</th>
              <th>{t("cust.cat.colBudget")}</th>
              <th>{t("cust.cat.colExclude")}</th>
              <th></th>
            </tr>
          </thead>
          <tbody>
            {cats.length === 0 && (
              <tr>
                <td colSpan={4} className="muted">
                  {t("cust.cat.empty")}
                </td>
              </tr>
            )}
            {cats.map((c) => (
              <React.Fragment key={c.id}>
                <tr>
                  <td>
                    <input
                      defaultValue={c.name}
                      onBlur={(e) => rename(c.id, e.target.value)}
                      onKeyDown={(e) => {
                        if (e.key === "Enter") e.currentTarget.blur();
                      }}
                    />
                  </td>
                  <td>
                    {/* budget editor interaction ported from Budget.tsx */}
                    <input
                      className="budget"
                      type="number"
                      min={0}
                      step="0.01"
                      defaultValue={c.budget}
                      onBlur={(e) => {
                        const v = Number(e.target.value);
                        if (Number.isFinite(v) && v >= 0 && v !== c.budget) saveBudget(c.id, v);
                      }}
                    />
                  </td>
                  <td>
                    <input
                      type="checkbox"
                      style={{ width: "auto" }}
                      checked={c.excludeFromTotals}
                      onChange={(e) => toggleExclude(c.id, e.target.checked)}
                    />
                  </td>
                  <td>
                    <button className="btn btn-sm btn-ghost" onClick={() => del(c.id)}>
                      {t("cust.cat.delete")}
                    </button>
                  </td>
                </tr>
                {rowError[c.id] && (
                  <tr>
                    <td colSpan={4} className="error" style={{ paddingTop: 0 }}>
                      {rowError[c.id]}
                    </td>
                  </tr>
                )}
              </React.Fragment>
            ))}
          </tbody>
        </table>
      </div>

      <div className="row" style={{ gap: 8 }}>
        <input
          style={{ maxWidth: 260 }}
          placeholder={t("cust.cat.newPlaceholder")}
          value={newName}
          onChange={(e) => setNewName(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter") create();
          }}
        />
        <button
          className="btn btn-primary"
          disabled={creating || !newName.trim()}
          onClick={create}
        >
          {creating ? t("common.saving") : t("cust.cat.add")}
        </button>
      </div>
      {createError && <div className="error">{createError}</div>}
    </div>
  );
}
