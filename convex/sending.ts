import { v } from "convex/values";
import { ALERT_WINDOW_MS, isClosedStatus, matchingChoices, type AlertRow } from "../shared/alerts";
import type { Id } from "./_generated/dataModel";
import { internalMutation } from "./_generated/server";

/** A failed row may be retried until it has failed this many times. */
const MAX_ATTEMPTS = 3;

export const rowValidator = v.object({
  matchId: v.number(),
  sportId: v.number(),
  kickoffMs: v.union(v.null(), v.number()),
  statusCode: v.union(v.null(), v.number()),
  competition: v.union(v.null(), v.object({ id: v.union(v.null(), v.number()), name: v.union(v.null(), v.string()) })),
  title: v.union(v.null(), v.string()),
  teams: v.array(v.object({ id: v.union(v.null(), v.number()), name: v.string() })),
  slugs: v.union(v.null(), v.object({ match: v.string(), competition: v.string() })),
});

export type SendJob = {
  ledgerId: Id<"ledger">;
  userId: Id<"users">;
  email: string;
  row: AlertRow;
};

/**
 * One cron tick's send decisions for the rows that are streaming right now.
 * Applies rules 2-6 of docs/match-alerts.md (rule 1, "the match streams", is
 * the caller's filter) and claims the ledger. The ledger insert is the claim:
 * a concurrent tick finds the row and stops, so only one tick can ever send.
 * Returns the claimed jobs for the action to mail.
 */
export const ingest = internalMutation({
  args: { rows: v.array(rowValidator), now: v.number() },
  handler: async (ctx, { rows, now }): Promise<SendJob[]> => {
    const choices = await ctx.db.query("alertChoices").collect();
    const jobs: SendJob[] = [];

    for (const row of rows) {
      // Record the first appearance in the stream list, whoever has chosen it:
      // a viewer who adds the club mid-match must stay silent for that match.
      let stream = await ctx.db
        .query("streams")
        .withIndex("by_match", (q) => q.eq("matchId", row.matchId))
        .unique();
      if (stream === null) {
        const id = await ctx.db.insert("streams", { matchId: row.matchId, sportId: row.sportId, kickoffMs: row.kickoffMs, firstSeenAt: now });
        stream = (await ctx.db.get(id))!;
      }

      // Rule 2: only the status code that says "over or called off" blocks.
      if (isClosedStatus(row.statusCode)) continue;
      // Rule 5: open for 45 minutes from the earlier of kickoff and first appearance.
      const startedAt = Math.min(row.kickoffMs ?? stream.firstSeenAt, stream.firstSeenAt);
      if (now - startedAt >= ALERT_WINDOW_MS) continue;

      const hit = matchingChoices(row);
      if (hit.clubs.length === 0 && hit.sports.length === 0) continue;

      for (const choice of choices) {
        // Rule 3 + 4: the viewer chose it, and chose it before the stream first appeared.
        const enabled = [
          ...choice.clubs.filter((club) => hit.clubs.includes(club.clubId)).map((club) => club.enabledAt),
          ...choice.sports.filter((sport) => (hit.sports as string[]).includes(sport.sport)).map((sport) => sport.enabledAt),
        ];
        if (!enabled.some((enabledAt) => enabledAt < stream.firstSeenAt)) continue;

        // Rule 6: no ledger row yet, or a failed one with retries left.
        const ledger = await ctx.db
          .query("ledger")
          .withIndex("by_user_match", (q) => q.eq("userId", choice.userId).eq("matchId", row.matchId))
          .unique();
        let ledgerId: Id<"ledger">;
        if (ledger === null) {
          ledgerId = await ctx.db.insert("ledger", {
            userId: choice.userId,
            matchId: row.matchId,
            watchPath: null,
            status: "sending",
            attempts: 0,
            claimedAt: now,
          });
        } else if (ledger.status === "failed" && ledger.attempts < MAX_ATTEMPTS) {
          await ctx.db.patch(ledger._id, { status: "sending", claimedAt: now });
          ledgerId = ledger._id;
        } else {
          continue;
        }

        const user = await ctx.db.get(choice.userId);
        if (user?.email === undefined) {
          // An account without a mailbox cannot be mailed; close the claim so it is not retried every tick.
          await ctx.db.patch(ledgerId, { status: "failed", attempts: MAX_ATTEMPTS });
          continue;
        }
        jobs.push({ ledgerId, userId: choice.userId, email: user.email, row });
      }
    }
    return jobs;
  },
});

/**
 * Brevo's verdict. `sent` and `rejected` are the only outcomes this records:
 * a lost answer ("unknown") leaves the row `sending` forever, because the
 * mail may have gone out and a lost mail is preferred over a duplicate.
 */
export const finish = internalMutation({
  args: { ledgerId: v.id("ledger"), outcome: v.union(v.literal("sent"), v.literal("rejected")) },
  handler: async (ctx, { ledgerId, outcome }) => {
    const ledger = await ctx.db.get(ledgerId);
    if (ledger === null) return;
    if (outcome === "sent") await ctx.db.patch(ledgerId, { status: "sent" });
    else await ctx.db.patch(ledgerId, { status: "failed", attempts: ledger.attempts + 1 });
  },
});

/** Daily housekeeping, and the count of mails whose outcome was never learned. */
export const maintain = internalMutation({
  args: { now: v.number() },
  handler: async (ctx, { now }) => {
    const DAY = 24 * 60 * 60 * 1000;
    for (const stream of await ctx.db
      .query("streams")
      .withIndex("by_first_seen", (q) => q.lt("firstSeenAt", now - 2 * DAY))
      .take(500)) {
      await ctx.db.delete(stream._id);
    }
    // Matches close 45 minutes after they start, so a ledger row older than two weeks can never matter again.
    for (const row of await ctx.db
      .query("ledger")
      .withIndex("by_status", (q) => q.eq("status", "sent").lt("claimedAt", now - 14 * DAY))
      .take(500)) {
      await ctx.db.delete(row._id);
    }
    const stuck = await ctx.db
      .query("ledger")
      .withIndex("by_status", (q) => q.eq("status", "sending").lt("claimedAt", now - 60 * 60 * 1000))
      .collect();
    return { stuckSending: stuck.length };
  },
});
