import { getAuthUserId } from "@convex-dev/auth/server";
import { v } from "convex/values";
import { internalMutation, mutation, query } from "./_generated/server";
import { sha256Hex } from "./signing";

/** A pairing expires after 5 minutes and is used once. */
const PAIRING_TTL_MS = 5 * 60 * 1000;

// No 0/O/1/I/L: the code is read off a TV from across a room and typed or compared on a phone.
const CODE_ALPHABET = "ABCDEFGHJKMNPQRSTUVWXYZ23456789";

const randomBelow = (limit: number): number => {
  const ceiling = 256 - (256 % limit);
  const byte = new Uint8Array(1);
  for (;;) {
    crypto.getRandomValues(byte);
    if (byte[0]! < ceiling) return byte[0]! % limit;
  }
};

const newDisplayCode = (): string => {
  const chars = Array.from({ length: 6 }, () => CODE_ALPHABET[randomBelow(CODE_ALPHABET.length)]!);
  return `${chars.slice(0, 3).join("")}-${chars.slice(3).join("")}`;
};

const newSecret = (): string => {
  const bytes = crypto.getRandomValues(new Uint8Array(24));
  return [...bytes].map((byte) => byte.toString(16).padStart(2, "0")).join("");
};

/** The TV (signed out) asks for a pairing: a short code to show and a secret only this browser holds. */
export const create = mutation({
  args: {},
  handler: async (ctx) => {
    const now = Date.now();
    let displayCode = newDisplayCode();
    for (;;) {
      const clash = await ctx.db
        .query("pairings")
        .withIndex("by_code", (q) => q.eq("displayCode", displayCode))
        .first();
      if (clash === null || clash.expiresAt < now) break;
      displayCode = newDisplayCode();
    }
    const secret = newSecret();
    const expiresAt = now + PAIRING_TTL_MS;
    await ctx.db.insert("pairings", {
      displayCode,
      secretHash: await sha256Hex(secret),
      status: "pending",
      expiresAt,
    });
    return { code: displayCode, secret, expiresAt };
  },
});

const findLive = async (
  ctx: { db: import("./_generated/server").QueryCtx["db"] },
  code: string,
  now: number,
) => {
  const pairing = await ctx.db
    .query("pairings")
    .withIndex("by_code", (q) => q.eq("displayCode", code))
    .order("desc")
    .first();
  return pairing !== null && pairing.expiresAt >= now ? pairing : null;
};

/** The TV's live query: has the phone approved yet? Only the holder of the secret may ask. */
export const watch = query({
  args: { code: v.string(), secret: v.string() },
  handler: async (ctx, { code, secret }) => {
    const pairing = await findLive(ctx, code, Date.now());
    if (pairing === null || pairing.secretHash !== (await sha256Hex(secret))) return "gone" as const;
    return pairing.status === "approved" ? ("approved" as const) : ("pending" as const);
  },
});

/** The phone's page: is this code still waiting to be approved? */
export const peek = query({
  args: { code: v.string() },
  handler: async (ctx, { code }) => {
    const pairing = await findLive(ctx, code.trim().toUpperCase(), Date.now());
    return pairing !== null && pairing.status === "pending";
  },
});

/** The phone approves the code for its signed-in user. */
export const approve = mutation({
  args: { code: v.string() },
  handler: async (ctx, { code }) => {
    const userId = await getAuthUserId(ctx);
    if (userId === null) throw new Error("Sign in on this device first.");
    const pairing = await findLive(ctx, code.trim().toUpperCase(), Date.now());
    if (pairing === null || pairing.status !== "pending") throw new Error("This code has expired. Ask the TV for a new one.");
    await ctx.db.patch(pairing._id, { status: "approved", approvedBy: userId });
  },
});

/** The custom credentials provider's check: secret, approval, expiry, and unused - then burn it. */
export const consume = internalMutation({
  args: { code: v.string(), secret: v.string() },
  handler: async (ctx, { code, secret }) => {
    const pairing = await findLive(ctx, code, Date.now());
    if (pairing === null || pairing.status !== "approved" || pairing.approvedBy === undefined) return null;
    if (pairing.secretHash !== (await sha256Hex(secret))) return null;
    await ctx.db.patch(pairing._id, { status: "used" });
    return pairing.approvedBy;
  },
});

export const sweep = internalMutation({
  args: {},
  handler: async (ctx) => {
    const expired = await ctx.db
      .query("pairings")
      .withIndex("by_expiry", (q) => q.lt("expiresAt", Date.now() - 60 * 60 * 1000))
      .take(500);
    for (const pairing of expired) await ctx.db.delete(pairing._id);
  },
});
