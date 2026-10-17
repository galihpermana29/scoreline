import { cronJobs } from "convex/server";
import { internal } from "./_generated/api";

const crons = cronJobs();

crons.interval("alert tick", { minutes: 1 }, internal.feed.tick, {});
crons.daily("alert daily check", { hourUTC: 21, minuteUTC: 0 }, internal.feed.daily, {});
crons.interval("sweep pairings", { hours: 1 }, internal.feed.sweepPairings, {});

export default crons;
