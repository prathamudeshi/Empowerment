import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { sendInviteNotificationEmail } from "@/lib/gmail";

export async function POST(req: NextRequest) {
  try {
    const body = await req.json().catch(() => null);
    if (!body) {
      return NextResponse.json({ error: "Invalid request payload" }, { status: 400 });
    }

    const { name, email, reason } = body;

    if (!name || typeof name !== "string" || !name.trim()) {
      return NextResponse.json({ error: "Please enter your name" }, { status: 400 });
    }

    if (!email || typeof email !== "string" || !email.includes("@")) {
      return NextResponse.json({ error: "Please enter a valid email address" }, { status: 400 });
    }

    // Save the request into the database
    const invite = await prisma.inviteRequest.create({
      data: {
        name: name.trim(),
        email: email.trim().toLowerCase(),
        reason: reason ? reason.trim() : null,
      },
    });

    console.log(`[Invite Request] Saved invite request for ${invite.email} (${invite.name}) to DB`);

    // Dispatch notification email to udeshipratham3@gmail.com
    await sendInviteNotificationEmail(invite.name, invite.email, invite.reason || undefined);

    return NextResponse.json({
      success: true,
      message: "Your invite request has been received.",
    });
  } catch (error: any) {
    console.error("Invite submission error:", error);
    return NextResponse.json(
      { error: error?.message || "Failed to submit request" },
      { status: 500 }
    );
  }
}
