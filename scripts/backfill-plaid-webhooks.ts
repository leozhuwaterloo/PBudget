// One-time: register the webhook URL on already-linked items. New links get it via
// createLinkToken; existing prod items predate the webhook and stay manual-sync until
// this runs. Idempotent + re-runnable. Run in the pod (needs APP_URL=https://… so
// webhookUrl() is set): tsx scripts/backfill-plaid-webhooks.ts
import { prisma } from "../src/lib/db";
import { updateItemWebhook } from "../src/lib/plaid";

(async () => {
  const items = await prisma.plaidItem.findMany({
    where: { disconnectedAt: null, accessToken: { not: "" } },
    select: { itemId: true, accessToken: true },
  });
  let ok = 0;
  for (const it of items) {
    try {
      await updateItemWebhook(it.accessToken);
      ok++;
    } catch (e: any) {
      console.error(`  ✗ ${it.itemId}: ${e?.response?.data?.error_message ?? e?.message}`);
    }
  }
  console.log(`Registered webhook on ${ok}/${items.length} items.`);
  await prisma.$disconnect();
})();
