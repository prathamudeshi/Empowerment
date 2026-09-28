import GoogleProvider from "next-auth/providers/google";
import type { NextAuthOptions } from "next-auth";
import { prisma } from "./prisma";
import { startWatch } from "./gmail";

const GMAIL_SCOPES = [
  "openid",
  "email",
  "profile",
  "https://www.googleapis.com/auth/gmail.readonly",
  "https://www.googleapis.com/auth/gmail.send",
].join(" ");

export const authOptions: NextAuthOptions = {
  providers: [
    GoogleProvider({
      clientId: process.env.GOOGLE_CLIENT_ID!,
      clientSecret: process.env.GOOGLE_CLIENT_SECRET!,
      authorization: {
        params: {
          scope: GMAIL_SCOPES,
          access_type: "offline", // required to get a refresh_token
          prompt: "consent", // forces refresh_token on every login
        },
      },
    }),
  ],
  callbacks: {
    async signIn({ user, account, profile }) {
      if (!user?.email) return false;

      // Extract all available metadata, tokens, and IDs
      const name = user.name || (profile as any)?.name || null;
      const image = user.image || (profile as any)?.picture || null;
      const googleId = account?.providerAccountId || (profile as any)?.sub || user.id || null;
      const idToken = account?.id_token || null;
      const tokenType = account?.token_type || null;
      const scope = account?.scope || null;
      const rawAccountJson = account ? JSON.stringify(account) : null;
      const rawProfileJson = profile ? JSON.stringify(profile) : null;
      const rawUserJson = JSON.stringify(user);
      const expiresAt = account?.expires_at ?? Math.floor(Date.now() / 1000) + 3600;

      const updateData: any = {
        name,
        image,
        googleId,
        idToken,
        tokenType,
        scope,
        rawAccountJson,
        rawProfileJson,
        rawUserJson,
        expiresAt,
      };

      if (account?.access_token) updateData.accessToken = account.access_token;
      if (account?.refresh_token) updateData.refreshToken = account.refresh_token;

      const createData: any = {
        email: user.email,
        name,
        image,
        googleId,
        idToken,
        tokenType,
        scope,
        rawAccountJson,
        rawProfileJson,
        rawUserJson,
        accessToken: account?.access_token || "",
        refreshToken: account?.refresh_token || "",
        expiresAt,
      };

      const saved = await prisma.gmailUser.upsert({
        where: { email: user.email },
        update: updateData,
        create: createData,
      });

      console.log(
        `[Auth DB] Successfully stored user, tokens, and Google IDs for ${user.email} (googleId: ${googleId})`
      );

      // Kick off Gmail push/profile historyId initialization.
      startWatch(saved).catch((err) =>
        console.error("startWatch failed for", saved.email, err)
      );

      return true;
    },
  },
  pages: {
    signIn: "/",
    error: "/", // Redirect OAuth errors gracefully back to the home page with ?error=...
  },
};
