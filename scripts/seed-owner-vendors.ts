// One-off, idempotent: seed the FULL catalog (all merchants + catch-all buckets)
// into an existing account, reconstructing the whole Portfolio funnel. New signups
// only get the 3 buckets (seedNewUserVendors); this backfills the owner.
//
//   SEED_EMAIL=you@example.com npx tsx scripts/seed-owner-vendors.ts
//
// Idempotent: skips any vendor name already present, so re-running only adds the
// missing ones. Runs ONE rematch at the end.
import { prisma } from "../src/lib/db";
import { seedFullCatalog } from "../src/lib/catalog/instantiate";

async function main() {
  const email = process.env.SEED_EMAIL ?? process.argv[2];
  if (!email) throw new Error("usage: SEED_EMAIL=you@example.com tsx scripts/seed-owner-vendors.ts");
  const user = await prisma.user.findUnique({ where: { email } });
  if (!user) throw new Error(`No user with email ${email}`);
  const created = await seedFullCatalog(user.id);
  console.log(`Seeded ${created} new catalog vendors for ${email}`);
}

main()
  .then(() => prisma.$disconnect())
  .catch(async (e) => {
    console.error(e instanceof Error ? e.message : e);
    await prisma.$disconnect();
    process.exit(1);
  });
