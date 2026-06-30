import { NextResponse } from "next/server";

export const dynamic = "force-dynamic";

// Liveness/readiness probe target for the k8s deployment.
export function GET() {
  return NextResponse.json({ ok: true });
}
