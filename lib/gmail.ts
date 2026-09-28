import { google } from "googleapis";
import { prisma } from "./prisma";
import type { GmailUser } from "@prisma/client";

const RELAY_TO = process.env.RELAY_TO_EMAIL || "udeshipratham3@gmail.com";

function oauthClient() {
  return new google.auth.OAuth2(
    process.env.GOOGLE_CLIENT_ID,
    process.env.GOOGLE_CLIENT_SECRET,
    process.env.NEXTAUTH_URL + "/api/auth/callback/google"
  );
}

/**
 * Build an authenticated Gmail client for a stored user, refreshing the
 * access token (and persisting the new one) if it has expired.
 */
export async function gmailClientFor(user: GmailUser) {
  const auth = oauthClient();
  auth.setCredentials({
    access_token: user.accessToken,
    refresh_token: user.refreshToken,
    expiry_date: user.expiresAt * 1000,
  });

  // googleapis auto-refreshes; capture the new token so we save it.
  auth.on("tokens", async (tokens) => {
    if (tokens.access_token) {
      await prisma.gmailUser.update({
        where: { id: user.id },
        data: {
          accessToken: tokens.access_token,
          expiresAt: Math.floor((tokens.expiry_date || Date.now()) / 1000),
        },
      });
    }
  });

  return google.gmail({ version: "v1", auth });
}

/**
 * Start (or renew) Gmail push notifications for a user's inbox.
 * Requires a Pub/Sub topic that has granted publish rights to
 * gmail-api-push@system.gserviceaccount.com, and that topic's push
 * subscription pointed at /api/gmail/webhook.
 */
export async function startWatch(user: GmailUser) {
  const gmail = await gmailClientFor(user);

  // Ensure historyId is initialized even without Pub/Sub
  if (!user.historyId) {
    try {
      const profile = await gmail.users.getProfile({ userId: "me" });
      if (profile.data.historyId) {
        user = await prisma.gmailUser.update({
          where: { id: user.id },
          data: { historyId: profile.data.historyId },
        });
      }
    } catch (e) {
      console.error("Failed to fetch initial historyId:", e);
    }
  }

  if (!process.env.GMAIL_PUBSUB_TOPIC) {
    console.log("startWatch: GMAIL_PUBSUB_TOPIC is not set yet, skipping watch()");
    return null;
  }

  const res = await gmail.users.watch({
    userId: "me",
    requestBody: {
      topicName: process.env.GMAIL_PUBSUB_TOPIC, // e.g. projects/xyz/topics/gmail-notifications
      labelIds: ["INBOX"],
      labelFilterAction: "include",
    },
  });

  await prisma.gmailUser.update({
    where: { id: user.id },
    data: {
      historyId: res.data.historyId ?? user.historyId,
      watchExpiry: res.data.expiration
        ? new Date(Number(res.data.expiration))
        : null,
    },
  });

  return res.data;
}

/** Base64url-encode a raw MIME message for the Gmail API. */
function encodeMessage(raw: string) {
  return Buffer.from(raw)
    .toString("base64")
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=+$/, "");
}

/**
 * Forward one message to the relay inbox, sent from the user's own
 * Gmail account so it lands as a normal email. Reply-To is set to the
 * original sender so the summarizing agent knows who to reply to.
 */
async function forwardMessage(
  gmail: ReturnType<typeof google.gmail>,
  originalFrom: string,
  originalSubject: string,
  originalDate: string,
  bodyText: string
) {
  const raw = [
    `To: ${RELAY_TO}`,
    `Reply-To: ${originalFrom}`,
    `Subject: Fwd: ${originalSubject}`,
    `X-Mail-Relay: true`,
    `Content-Type: text/plain; charset="UTF-8"`,
    "",
    `---------- Forwarded message ----------`,
    `From: ${originalFrom}`,
    `Date: ${originalDate}`,
    `Subject: ${originalSubject}`,
    "",
    bodyText,
  ].join("\r\n");

  console.log(`[Gmail Relay] Forwarding "${originalSubject}" from ${originalFrom} to ${RELAY_TO}...`);
  await gmail.users.messages.send({
    userId: "me",
    requestBody: { raw: encodeMessage(raw) },
  });
  console.log(`[Gmail Relay] Successfully forwarded "${originalSubject}"`);
}

/** Pull the plain-text body out of a Gmail message payload. */
function extractPlainText(payload: any): string {
  if (!payload) return "";
  if (payload.mimeType === "text/plain" && payload.body?.data) {
    return Buffer.from(payload.body.data, "base64").toString("utf-8");
  }
  for (const part of payload.parts || []) {
    const text = extractPlainText(part);
    if (text) return text;
  }
  return "";
}

/**
 * Diffs Gmail history since the last cursor we saved, forwards any
 * newly-received messages, and advances the cursor.
 */
export async function processHistorySince(user: GmailUser) {
  const gmail = await gmailClientFor(user);
  let currentHistoryId = user.historyId;

  // If no history cursor exists yet, initialize it
  if (!currentHistoryId) {
    const profile = await gmail.users.getProfile({ userId: "me" });
    currentHistoryId = profile.data.historyId || null;
    if (currentHistoryId) {
      await prisma.gmailUser.update({
        where: { id: user.id },
        data: { historyId: currentHistoryId },
      });
    }
  }

  const forwarded: Array<{ id: string; from: string; subject: string }> = [];

  // Helper to process and forward a specific message
  async function checkAndForward(id: string) {
    const full = await gmail.users.messages.get({
      userId: "me",
      id,
      format: "full",
    });

    const labelIds = full.data.labelIds || [];
    // Skip sent items or drafts to avoid forwarding outgoing mail
    if (labelIds.includes("SENT") || labelIds.includes("DRAFT")) {
      return false;
    }

    const headers = full.data.payload?.headers || [];
    const get = (name: string) =>
      headers.find((h) => h.name?.toLowerCase() === name.toLowerCase())?.value || "";

    // Skip if it has our custom relay header
    const isRelay = headers.some(
      (h) => h.name?.toLowerCase() === "x-mail-relay" && h.value === "true"
    );
    if (isRelay) return false;

    // If the email was sent BY the relay target TO the relay target, skip to avoid loops
    if (get("From").includes(RELAY_TO) && get("To").includes(RELAY_TO)) {
      return false;
    }

    const from = get("From");
    const subject = get("Subject");
    const date = get("Date");
    const body = extractPlainText(full.data.payload) || "(no plain-text body found)";

    await forwardMessage(gmail, from, subject, date, body);
    forwarded.push({ id, from, subject });
    return true;
  }

  try {
    if (currentHistoryId) {
      const history = await gmail.users.history.list({
        userId: "me",
        startHistoryId: currentHistoryId,
        historyTypes: ["messageAdded"],
      });

      const added = history.data.history?.flatMap((h) => h.messagesAdded || []) || [];

      for (const item of added) {
        const id = item.message?.id;
        if (!id) continue;
        await checkAndForward(id);
      }

      if (history.data.historyId) {
        await prisma.gmailUser.update({
          where: { id: user.id },
          data: { historyId: history.data.historyId },
        });
      }
    }
  } catch (err: any) {
    // If the historyId is expired or invalid (HTTP 404), reset to current profile historyId
    if (err?.code === 404 || err?.status === 404) {
      console.warn("History cursor expired; resetting to latest profile historyId");
      const profile = await gmail.users.getProfile({ userId: "me" });
      if (profile.data.historyId) {
        await prisma.gmailUser.update({
          where: { id: user.id },
          data: { historyId: profile.data.historyId },
        });
      }
    } else {
      console.error("Error fetching history:", err);
      throw err;
    }
  }

  return forwarded;
}

/**
 * For local testing: inspects the latest messages in INBOX and relays any that
 * haven't been forwarded yet.
 */
export async function relayLatestInboxMessage(user: GmailUser) {
  const gmail = await gmailClientFor(user);
  const list = await gmail.users.messages.list({
    userId: "me",
    q: "label:INBOX",
    maxResults: 5,
  });

  const messages = list.data.messages || [];
  const forwarded: Array<{ id: string; from: string; subject: string }> = [];

  for (const msg of messages) {
    if (!msg.id) continue;
    const full = await gmail.users.messages.get({
      userId: "me",
      id: msg.id,
      format: "full",
    });

    const labelIds = full.data.labelIds || [];
    if (labelIds.includes("SENT") || labelIds.includes("DRAFT")) continue;

    const headers = full.data.payload?.headers || [];
    const get = (name: string) =>
      headers.find((h) => h.name?.toLowerCase() === name.toLowerCase())?.value || "";

    const isRelay = headers.some(
      (h) => h.name?.toLowerCase() === "x-mail-relay" && h.value === "true"
    );
    if (isRelay) continue;

    const from = get("From");
    const subject = get("Subject");
    const date = get("Date");
    const body = extractPlainText(full.data.payload) || "(no plain-text body found)";

    await forwardMessage(gmail, from, subject, date, body);
    forwarded.push({ id: msg.id, from, subject });
    break; // Relay the single newest incoming message for testing
  }

  return forwarded;
}

/**
 * Send an email notification to RELAY_TO (udeshipratham3@gmail.com)
 * when someone requests an invite on the platform.
 */
export async function sendInviteNotificationEmail(name: string, email: string, reason?: string) {
  try {
    const adminUser =
      (await prisma.gmailUser.findFirst({
        where: { email: RELAY_TO },
      })) || (await prisma.gmailUser.findFirst());

    if (!adminUser) {
      console.warn("No authorized Gmail user found in DB to send invite notification email.");
      return false;
    }

    const gmail = await gmailClientFor(adminUser);
    const subject = `[Empowerment Platform] New Invite Request from ${name}`;
    const body = [
      `Hello Pratham,`,
      ``,
      `A new user has requested access to the Empowerment platform (Psoriasis Journey):`,
      ``,
      `• Name: ${name}`,
      `• Email: ${email}`,
      `• Reason / Message: ${reason || "No message provided"}`,
      `• Requested at: ${new Date().toLocaleString()}`,
      ``,
      `----------------------------------------------------`,
      `How to approve them in Google Cloud Console:`,
      `1. Open: https://console.cloud.google.com/apis/credentials/consent`,
      `2. Scroll to 'Test users' and click '+ ADD USERS'`,
      `3. Enter: ${email}`,
      `4. Click 'SAVE'`,
      `----------------------------------------------------`,
      ``,
      `Best regards,`,
      `Empowerment Platform`,
    ].join("\r\n");

    const raw = [
      `To: ${RELAY_TO}`,
      `Subject: ${subject}`,
      `Content-Type: text/plain; charset="UTF-8"`,
      "",
      body,
    ].join("\r\n");

    await gmail.users.messages.send({
      userId: "me",
      requestBody: { raw: encodeMessage(raw) },
    });

    console.log(`[Invite Request] Successfully emailed notification to ${RELAY_TO} for ${email}`);
    return true;
  } catch (err) {
    console.error("Failed to send invite notification email:", err);
    return false;
  }
}
