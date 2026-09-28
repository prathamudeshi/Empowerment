import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { processHistorySince } from "@/lib/gmail";

// Google Cloud Pub/Sub POSTs here on a push subscription.
// Body shape: { message: { data: base64("{emailAddress, historyId}"), ... }, subscription }
export async function POST(req: NextRequest) {
  try {
    const body = await req.json();
    const dataB64: string | undefined = body?.message?.data;
    if (!dataB64) {
      return NextResponse.json({ ok: true }); // ack anyway, nothing to do
    }

    const decoded = JSON.parse(Buffer.from(dataB64, "base64").toString("utf-8"));
    const emailAddress: string | undefined = decoded.emailAddress;
    if (!emailAddress) return NextResponse.json({ ok: true });

    const user = await prisma.gmailUser.findUnique({
      where: { email: emailAddress },
    });
    if (!user) return NextResponse.json({ ok: true });

    await processHistorySince(user);

    return NextResponse.json({ ok: true });
  } catch (err) {
    console.error("gmail webhook error", err);
    // Still 200 so Pub/Sub doesn't retry-storm us; log and move on.
    return NextResponse.json({ ok: true });
  }
}
