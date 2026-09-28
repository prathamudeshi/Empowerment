import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { startWatch } from "@/lib/gmail";

// Gmail's users.watch() expires after ~7 days. Point a daily Vercel Cron
// (or any scheduler) at this route to keep every user's watch alive.
export async function GET(req: Request) {
  // Simple shared-secret check so this can't be hit by randoms.
  const auth = req.headers.get("authorization");
  if (auth !== `Bearer ${process.env.CRON_SECRET}`) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }

  const users = await prisma.gmailUser.findMany();
  const results = await Promise.allSettled(users.map((u) => startWatch(u)));

  const failed = results.filter((r) => r.status === "rejected").length;
  return NextResponse.json({ renewed: users.length - failed, failed });
}
