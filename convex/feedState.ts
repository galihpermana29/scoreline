import { v } from "convex/values";
import { internalMutation, internalQuery, type QueryCtx } from "./_generated/server";

/** Failed ticks in a row before the operator is mailed. */
export const ALARM_AFTER_TICKS = 10;

/** The discovered host order is trusted for this long before the entry page is read again. */
export const HOSTS_TTL_MS = 10 * 60 * 1000;

const current = async (ctx: Pick<QueryCtx, "db">) => (await ctx.db.query("feedState").first()) ?? null;

export const get = internalQuery({
  args: {},
  handler: async (ctx) => current(ctx),
});

/** Persists the working host order (empty clears it, forcing re-discovery next tick). */
export const setHosts = internalMutation({
  args: { hosts: v.array(v.string()) },
  handler: async (ctx, { hosts }) => {
    const state = await current(ctx);
    const now = Date.now();
    if (state === null) await ctx.db.insert("feedState", { hosts, hostsAt: now, failureStreak: 0, alarmRaised: false });
    else await ctx.db.patch(state._id, { hosts, hostsAt: now });
  },
});

/**
 * Records one tick's verdict and says whether the operator mail is due.
 * The state change is the claim, so two overlapping ticks cannot both mail:
 * "down" fires once when the streak reaches the threshold, "up" once when
 * the feed answers again afterwards.
 */
export const record = internalMutation({
  args: { allFailed: v.boolean() },
  handler: async (ctx, { allFailed }) => {
    const state = await current(ctx);
    const streak = allFailed ? (state?.failureStreak ?? 0) + 1 : 0;
    let mail: "down" | "up" | null = null;
    let alarmRaised = state?.alarmRaised ?? false;
    if (allFailed && !alarmRaised && streak >= ALARM_AFTER_TICKS) {
      alarmRaised = true;
      mail = "down";
    } else if (!allFailed && alarmRaised) {
      alarmRaised = false;
      mail = "up";
    }
    if (state === null) await ctx.db.insert("feedState", { hosts: [], hostsAt: 0, failureStreak: streak, alarmRaised });
    else await ctx.db.patch(state._id, { failureStreak: streak, alarmRaised });
    return { mail, streak };
  },
});
