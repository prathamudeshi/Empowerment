import { NextRequest, NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { processHistorySince, relayLatestInboxMessage } from "@/lib/gmail";

export async function POST(req: NextRequest) {
  try {
    const session = await getServerSession(authOptions);
    if (!session?.user?.email) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const user = await prisma.gmailUser.findUnique({
      where: { email: session.user.email },
    });

    if (!user) {
      return NextResponse.json({ error: "User not found in database" }, { status: 404 });
    }

    const { forceLatest } = await req.json().catch(() => ({ forceLatest: false }));

    const now = new Date().toLocaleTimeString();
    console.log(`[${now}] [Gmail 5s Poll] Checking mailbox for ${user.email} (historyId: ${user.historyId || 'initial'})...`);

    let forwarded = await processHistorySince(user);

    // If history cursor was already past or missed the test email, allow forcing the latest inbox message
    if (forwarded.length === 0 && forceLatest) {
      forwarded = await relayLatestInboxMessage(user);
    }

    if (forwarded.length > 0) {
      console.log(`[${now}] [Gmail 5s Poll] Found and relayed ${forwarded.length} new email(s).`);
    } else {
      console.log(`[${now}] [Gmail 5s Poll] No new messages.`);
    }

    return NextResponse.json({
      success: true,
      forwardedCount: forwarded.length,
      forwarded,
    });
  } catch (error: any) {
    console.error("Sync error:", error);
    return NextResponse.json(
      { error: error?.message || "Internal server error" },
      { status: 500 }
    );
  }
}
