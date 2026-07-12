import { NextResponse } from "next/server";
import { applyGoogleNotification } from "@/lib/iap";

// Google Real-time Developer Notifications (RTDN), delivered as a Pub/Sub push:
// { message: { data: base64(json) } }. We DON'T trust the push contents — it only
// tells us which purchase token changed; applyGoogleNotification re-queries the Play
// Developer API (authoritative) before updating the tier. Always 200 so Pub/Sub acks
// (a non-2xx triggers redelivery); a bad/unknown message is simply a no-op.
export async function POST(req: Request) {
  const body = await req.json().catch(() => ({}));
  try {
    await applyGoogleNotification(body);
  } catch {
    // swallow: RTDN redelivery is not helpful for a permanently malformed message,
    // and a transient Play API blip is retried by the next notification / renewal.
  }
  return NextResponse.json({ ok: true });
}
