// F2 vendor decisions (SPEC "Vendor approval", FR2, criteria 2/3/19). Thin wrapper
// over F1's rule paths — the median/unusual logic is NOT reimplemented here; we
// call evaluateUnusualForVendor (same code path as analyzeUser's rule 5.3).
import { prisma } from "../db";
import { normalizeVendor } from "./vendor";
import { evaluateUnusualForVendor } from "./analyze";
import { RULES } from "./constants";

// Approve: mark approved → resolve ALL the vendor's open unknown_vendor flags
// (txn + group level) → re-run unusual_amount over its existing charges (FR1.3
// approval re-run, criterion 19), respecting dismissal permanence and merge
// exemptions. Returns the vendor, or null if it isn't the user's.
export async function approveVendor(userId: string, vendorId: string) {
  const vendor = await prisma.vendor.findFirst({ where: { id: vendorId, userId } });
  if (!vendor) return null;

  await prisma.vendor.update({
    where: { id: vendor.id },
    data: { status: "approved", decidedAt: new Date() },
  });
  await resolveUnknownVendorFlags(userId, vendor.name);
  // Must run AFTER status flips to approved — evaluateUnusualForVendor no-ops on
  // an unapproved vendor. It reuses F1's median path; nothing forked here.
  await evaluateUnusualForVendor(userId, vendor.name);

  return prisma.vendor.findUnique({ where: { id: vendor.id } });
}

// Reject: persist rejected only. Existing open flags stay open (dismissed
// per-transaction per FR4); future txns keep getting flagged by the analyzer,
// since the vendor is still ≠ approved. No flag changes here.
export async function rejectVendor(userId: string, vendorId: string) {
  const vendor = await prisma.vendor.findFirst({ where: { id: vendorId, userId } });
  if (!vendor) return null;
  return prisma.vendor.update({
    where: { id: vendor.id },
    data: { status: "rejected", decidedAt: new Date() },
  });
}

// Resolve the vendor's open unknown_vendor flags on both individual txns and
// net-≠0 groups whose primary-leg vendor matches. Vendor identity has no FK, so
// match by the normalized name (same rule the analyzer flags by).
async function resolveUnknownVendorFlags(userId: string, vendorName: string): Promise<void> {
  const posted = await prisma.plaidTransaction.findMany({
    where: { pending: false, account: { item: { userId } } },
    select: { transactionId: true, merchantName: true, name: true },
  });
  const txnIds = posted
    .filter((t) => normalizeVendor(t.merchantName, t.name) === vendorName)
    .map((t) => t.transactionId);
  const groupIds = (
    await prisma.mergeGroup.findMany({ where: { userId, vendorName }, select: { id: true } })
  ).map((g) => g.id);

  const resolved = { status: "resolved", resolvedAt: new Date() };
  await prisma.transactionFlag.updateMany({
    where: { userId, rule: RULES.unknownVendor, status: "open", transactionId: { in: txnIds } },
    data: resolved,
  });
  await prisma.transactionFlag.updateMany({
    where: { userId, rule: RULES.unknownVendor, status: "open", mergeGroupId: { in: groupIds } },
    data: resolved,
  });
}
