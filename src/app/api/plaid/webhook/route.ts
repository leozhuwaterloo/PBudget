import { NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { decrypt } from "@/lib/crypto";
import { verifyWebhook, syncItem } from "@/lib/plaid";
import { analyzeUser } from "@/lib/analysis/analyze";

// Plaid POSTs here when an item has transaction updates. The URL is public, so the
// ES256 JWT signature is the ONLY thing gating work onto our Plaid quota + DB —
// verify it against the RAW body before doing anything.
// ponytail: syncItem + analyzeUser run inline (this pod is a persistent server, not
// Lambda). Ceiling: Plaid retries a webhook after ~10s; if a sync ever exceeds that,
// move the work to a queue and ack immediately. Our upserts are idempotent, so a
// retried webhook just re-syncs harmlessly.
export async function POST(req: Request) {
  const raw = await req.text();
  if (!(await verifyWebhook(raw, req.headers.get("plaid-verification")))) {
    return NextResponse.json({ error: "Invalid signature" }, { status: 401 });
  }

  const { webhook_type, webhook_code, item_id, removed_transactions } = JSON.parse(raw);
  // Only transaction updates drive a sync. ITEM webhooks (re-auth/expiry) and the
  // WEBHOOK_UPDATE_ACKNOWLEDGED ack are acked and ignored for now.
  if (webhook_type !== "TRANSACTIONS") return NextResponse.json({ received: true });

  const item = await prisma.plaidItem.findUnique({ where: { itemId: item_id } });
  // Unknown, disconnected (billing expiry), or token-cleared item → nothing to sync.
  if (!item || item.disconnectedAt || !item.accessToken) return NextResponse.json({ received: true });

  if (webhook_code === "TRANSACTIONS_REMOVED") {
    // Plaid canceled/removed these txns — delete locally (transactionsGet upserts
    // only, so it would never drop them on its own).
    if (Array.isArray(removed_transactions) && removed_transactions.length) {
      // Scope to this item (JWT already authenticates the sender; this also guards
      // against ever deleting a txn outside the item the webhook is for).
      await prisma.plaidTransaction.deleteMany({
        where: { transactionId: { in: removed_transactions }, account: { itemId: item_id } },
      });
    }
  } else {
    // INITIAL_UPDATE | HISTORICAL_UPDATE | DEFAULT_UPDATE — re-pull the window.
    // Skip refreshAndSync's forced transactionsRefresh: the webhook already means
    // Plaid has fresh data, so there's nothing to force (and no daily throttle to fight).
    await syncItem(item.userId, decrypt(item.accessToken));
  }
  await analyzeUser(item.userId);
  return NextResponse.json({ received: true });
}
