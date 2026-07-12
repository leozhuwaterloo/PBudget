import { NextResponse } from "next/server";
import { getSessionUser, destroySession } from "@/lib/auth";
import { prisma } from "@/lib/db";
import { stripe } from "@/lib/stripe";
import { removeConnection } from "@/lib/plaid";

// Session-gated hard delete of the current user + ALL their data (App Store 5.1.1(v)
// / Google Play in-app account deletion requirement). Order matters: cancel Stripe
// and revoke Plaid BEFORE deleting DB rows, since both need the stored ids/tokens.
export async function POST() {
  const user = await getSessionUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  // Cancel the Stripe subscription immediately (they're leaving — not at period end).
  // Logged, not silently swallowed; deletion still proceeds so a Stripe outage can't
  // trap the user in an app they asked to delete (an orphaned sub is loud in the log).
  if (user.stripeSubscriptionId) {
    try {
      await stripe().subscriptions.cancel(user.stripeSubscriptionId);
    } catch (e) {
      console.error(`[account-delete] Stripe cancel failed for ${user.id}`, e);
    }
  }

  // Revoke every LIVE Plaid item so Plaid stops billing + data access. removeConnection
  // is best-effort at Plaid (swallows its own errors); the rows are hard-deleted below
  // via the user.delete cascade. Disconnected items already have an empty token.
  const items = await prisma.plaidItem.findMany({
    where: { userId: user.id, accessToken: { not: "" } },
    select: { itemId: true, accessToken: true },
  });
  for (const it of items) await removeConnection(it.itemId, it.accessToken);

  // user.delete cascades: Session, EmailOtp, EmailVerificationToken, PasswordResetToken,
  // PlaidItem -> PlaidAccount -> PlaidTransaction, TransactionCategory, Vendor ->
  // VendorCondition. The rows below carry a bare `userId` scalar (no FK to User), so
  // they DON'T cascade — delete them explicitly first (their own children cascade:
  // SplitPart via TransactionSplit, MergeGroupLeg via MergeGroup).
  await prisma.$transaction([
    prisma.transactionSplit.deleteMany({ where: { userId: user.id } }),
    prisma.transactionFlag.deleteMany({ where: { userId: user.id } }),
    prisma.mergeGroup.deleteMany({ where: { userId: user.id } }),
    prisma.dissolvedGroupMemo.deleteMany({ where: { userId: user.id } }),
    prisma.deletedCategory.deleteMany({ where: { userId: user.id } }),
    prisma.categoryMapping.deleteMany({ where: { userId: user.id } }),
    prisma.user.delete({ where: { id: user.id } }),
  ]);

  await destroySession();
  return NextResponse.json({ ok: true });
}
