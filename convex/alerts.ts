import { getAuthUserId } from "@convex-dev/auth/server";
import { v } from "convex/values";
import {
  ALERT_SPORTS,
  BADMINTON_SPORT_ID,
  CLUBS,
  FOOTBALL_SPORT_ID,
  MOTORSPORT_SPORT_ID,
  type AlertSport,
} from "../shared/alerts";
import type { Doc, Id } from "./_generated/dataModel";
import { internalMutation, internalQuery, mutation, query, type MutationCtx } from "./_generated/server";

const clubIds: ReadonlySet<string> = new Set(CLUBS.map((club) => club.id));
const sportIds: ReadonlySet<string> = new Set(ALERT_SPORTS.map((sport) => sport.id));

const byUser = (ctx: MutationCtx, userId: Id<"users">) =>
  ctx.db
    .query("alertChoices")
    .withIndex("by_user", (q) => q.eq("userId", userId))
    .unique();

/** The signed-in viewer's choices, or null when signed out. A viewer with no row has never been prompted. */
export const mine = query({
  args: {},
  handler: async (ctx) => {
    const userId = await getAuthUserId(ctx);
    if (userId === null) return null;
    const row = await ctx.db
      .query("alertChoices")
      .withIndex("by_user", (q) => q.eq("userId", userId))
      .unique();
    return {
      clubs: row?.clubs.map((club) => club.clubId) ?? [],
      sports: (row?.sports.map((sport) => sport.sport) ?? []) as AlertSport[],
      prompted: row?.prompted ?? false,
    };
  },
});

/**
 * Saves the picker. A choice that was already on keeps its `enabledAt`, a new
 * one is stamped now - the send rules compare a match's first appearance in
 * the stream list against it, so re-saving never makes an old choice "new".
 */
export const save = mutation({
  args: { clubs: v.array(v.string()), sports: v.array(v.string()) },
  handler: async (ctx, args) => {
    const userId = await getAuthUserId(ctx);
    if (userId === null) throw new Error("Sign in to manage alerts.");
    const now = Date.now();
    const existing = await byUser(ctx, userId);
    const clubs = [...new Set(args.clubs)]
      .filter((id) => clubIds.has(id))
      .map((clubId) => ({ clubId, enabledAt: existing?.clubs.find((club) => club.clubId === clubId)?.enabledAt ?? now }));
    const sports = [...new Set(args.sports)]
      .filter((id) => sportIds.has(id))
      .map((sport) => ({ sport, enabledAt: existing?.sports.find((entry) => entry.sport === sport)?.enabledAt ?? now }));
    if (existing === null) await ctx.db.insert("alertChoices", { userId, clubs, sports, prompted: true });
    else await ctx.db.patch(existing._id, { clubs, sports, prompted: true });
  },
});

/** Skip stores an empty choice and marks the account prompted, so the picker never opens on its own again. */
export const skip = mutation({
  args: {},
  handler: async (ctx) => {
    const userId = await getAuthUserId(ctx);
    if (userId === null) throw new Error("Sign in to manage alerts.");
    const existing = await byUser(ctx, userId);
    if (existing === null) await ctx.db.insert("alertChoices", { userId, clubs: [], sports: [], prompted: true });
    else await ctx.db.patch(existing._id, { prompted: true });
  },
});

/** "Turn off all alerts" from the mail footer: clears every choice, keeps the prompted flag. */
export const clearAll = internalMutation({
  args: { userId: v.id("users") },
  handler: async (ctx, { userId }) => {
    const existing = await byUser(ctx, userId);
    if (existing === null) await ctx.db.insert("alertChoices", { userId, clubs: [], sports: [], prompted: true });
    else await ctx.db.patch(existing._id, { clubs: [], sports: [], prompted: true });
  },
});

/** The feed sports the cron has to fetch this minute: only what somebody chose. */
export const demand = internalQuery({
  args: {},
  handler: async (ctx) => {
    const sportTypes = new Set<number>();
    for (const row of await ctx.db.query("alertChoices").collect()) {
      if (row.clubs.length > 0) sportTypes.add(FOOTBALL_SPORT_ID);
      for (const { sport } of row.sports) {
        if (sport === "badminton") sportTypes.add(BADMINTON_SPORT_ID);
        else sportTypes.add(MOTORSPORT_SPORT_ID);
      }
    }
    return [...sportTypes].sort((a, b) => a - b);
  },
});

export type AlertChoicesDoc = Doc<"alertChoices">;
