import { authTables } from "@convex-dev/auth/server";
import { defineSchema, defineTable } from "convex/server";
import { v } from "convex/values";

export default defineSchema({
  // Users and sessions: Convex Auth's own.
  ...authTables,

  /** Per user: the chosen clubs and sports, each with when it was turned on. */
  alertChoices: defineTable({
    userId: v.id("users"),
    clubs: v.array(v.object({ clubId: v.string(), enabledAt: v.number() })),
    sports: v.array(v.object({ sport: v.string(), enabledAt: v.number() })),
    /** The first-sign-in picker has been shown (saved or skipped); it never opens on its own again. */
    prompted: v.boolean(),
  }).index("by_user", ["userId"]),

  /** QR pairing: a TV shows `displayCode` and holds the secret; a phone approves the code. */
  pairings: defineTable({
    displayCode: v.string(),
    secretHash: v.string(),
    status: v.union(v.literal("pending"), v.literal("approved"), v.literal("used")),
    approvedBy: v.optional(v.id("users")),
    expiresAt: v.number(),
  })
    .index("by_code", ["displayCode"])
    .index("by_expiry", ["expiresAt"]),

  /** A match's first appearance in the feed's stream list, which the send rules read. */
  streams: defineTable({
    matchId: v.number(),
    sportId: v.number(),
    kickoffMs: v.union(v.null(), v.number()),
    firstSeenAt: v.number(),
  })
    .index("by_match", ["matchId"])
    .index("by_first_seen", ["firstSeenAt"]),

  /** One row per viewer per match; only the cron tick that creates it may send. */
  ledger: defineTable({
    userId: v.id("users"),
    matchId: v.number(),
    watchPath: v.union(v.null(), v.string()),
    status: v.union(v.literal("sending"), v.literal("sent"), v.literal("failed")),
    attempts: v.number(),
    claimedAt: v.number(),
  })
    .index("by_user_match", ["userId", "matchId"])
    .index("by_status", ["status", "claimedAt"]),

  /** A single row: the discovered feed host order and the health-alarm state. */
  feedState: defineTable({
    hosts: v.array(v.string()),
    hostsAt: v.number(),
    failureStreak: v.number(),
    alarmRaised: v.boolean(),
  }),
});
