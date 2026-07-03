// Single analyzer entry point (SPEC "Analyzer semantics"). Called from the demo
// seed and from the sync route after upserts. Deterministic and idempotent.
//
// ponytail: no-op stub — F1 fills the four rules + auto-match. The signature is
// stable so the seed and sync route can call it now.
export async function analyzeUser(userId: string): Promise<void> {
  void userId;
}
