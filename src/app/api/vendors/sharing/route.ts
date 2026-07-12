import { NextResponse } from "next/server";
import { gate } from "@/lib/guard";
import { CatalogError } from "@/lib/catalog/instantiate";
import { setShared, detachLinked, resyncLinked } from "@/lib/catalog/share";

export const dynamic = "force-dynamic";

// POST /api/vendors/sharing { id, action } — single-vendor sharing/adoption state:
//   share | unshare — toggle whether others can adopt this vendor
//   resync          — re-pull a linked snapshot from its source (rematches; returns { claimed })
//   detach          — turn a linked snapshot into an independent editable clone
export async function POST(req: Request) {
  const g = await gate({ verified: true });
  if (g.error) return g.error;

  const body = (await req.json().catch(() => null)) as { id?: unknown; action?: unknown } | null;
  const id = typeof body?.id === "string" ? body.id : "";
  const action = body?.action;
  if (!id) return NextResponse.json({ error: "id required" }, { status: 400 });

  try {
    const uid = g.user!.id;
    switch (action) {
      case "share":
        await setShared(uid, id, true);
        break;
      case "unshare":
        await setShared(uid, id, false);
        break;
      case "detach":
        await detachLinked(uid, id);
        break;
      case "resync":
        return NextResponse.json(await resyncLinked(uid, id));
      default:
        return NextResponse.json({ error: "unknown action" }, { status: 400 });
    }
    return NextResponse.json({ ok: true });
  } catch (e) {
    if (e instanceof CatalogError) return NextResponse.json({ error: e.message }, { status: e.status });
    throw e;
  }
}
