import { CLUBS, matchingChoices, type AlertRow } from "../shared/alerts";
import type { ProtoField } from "../shared/protobuf";
import { parseProto } from "../shared/protobuf";
import { internal } from "./_generated/api";
import type { ActionCtx } from "./_generated/server";
import { internalAction } from "./_generated/server";
import { sendMail } from "./brevo";
import { HOSTS_TTL_MS } from "./feedState";
import type { SendJob } from "./sending";
import { alertMail, operatorMail, unsubscribeUrl } from "./mail";
import { discoverHosts, fallbackHosts, fetchFeed, fetchLeagueBytes, REQUEST_SPACING_MS, sleep } from "./source";
import { signUser } from "./signing";

/**
 * The working host order: the cached one while it is fresh, else a fresh
 * discovery from the entry page, with the Convex-env hosts as the fallback
 * at the back. Host rotation must not silence alerts.
 */
const resolveHosts = async (ctx: ActionCtx): Promise<string[]> => {
  const state = await ctx.runQuery(internal.feedState.get, {});
  const cached = state?.hosts ?? [];
  let hosts = cached;
  if (cached.length === 0 || Date.now() - (state?.hostsAt ?? 0) > HOSTS_TTL_MS) {
    const discovered = await discoverHosts();
    if (discovered !== null) {
      hosts = discovered;
      await ctx.runMutation(internal.feedState.setHosts, { hosts });
    }
  }
  return [...new Set([...hosts, ...fallbackHosts()])];
};

const operatorSend = async (subject: string, lines: readonly string[]): Promise<void> => {
  const to = process.env.OPERATOR_EMAIL;
  if (!to) {
    console.error(`[health] OPERATOR_EMAIL is not set; not mailed: ${subject}`);
    return;
  }
  const outcome = await sendMail(operatorMail(to, subject, lines));
  if (outcome.kind !== "sent") console.error(`[health] operator mail ${outcome.kind}`, outcome);
};

/**
 * Mails the claimed jobs, one mail per viewer: matches that started
 * streaming in the same tick share a message. Brevo's verdict is recorded on
 * every ledger row of that mail; a lost answer leaves them all `sending` and
 * they are never retried.
 */
export const sendJobs = async (ctx: ActionCtx, jobs: readonly SendJob[]): Promise<void> => {
  const appOrigin = process.env.APP_ORIGIN ?? "";
  const siteUrl = process.env.CONVEX_SITE_URL ?? "";
  const byUser = new Map<string, SendJob[]>();
  for (const job of jobs) byUser.set(job.userId, [...(byUser.get(job.userId) ?? []), job]);

  for (const group of byUser.values()) {
    const first = group[0]!;
    const link = unsubscribeUrl(siteUrl, first.userId, await signUser(first.userId));
    const outcome = await sendMail(alertMail({ rows: group.map((job) => job.row), to: first.email, appOrigin, unsubscribeLink: link }));
    const ids = group.map((job) => job.ledgerId);
    if (outcome.kind === "unknown") {
      // The mail may have gone out: leave the rows `sending`, never retry.
      console.error(`[alerts] no answer from Brevo for ledger ${ids.join(",")}: ${outcome.error}`);
      continue;
    }
    if (outcome.kind === "rejected") console.error(`[alerts] Brevo rejected ledger ${ids.join(",")}: ${outcome.status} ${outcome.body}`);
    for (const ledgerId of ids) {
      await ctx.runMutation(internal.sending.finish, { ledgerId, outcome: outcome.kind === "sent" ? "sent" : "rejected" });
    }
  }
};

/**
 * The every-minute cron. Fetches only the sports somebody chose, spaced
 * apart for Cloudflare, records each match's first stream appearance, applies
 * the send rules and mails the claimed jobs.
 */
export const tick = internalAction({
  args: {},
  handler: async (ctx) => {
    const sportTypes = await ctx.runQuery(internal.alerts.demand, {});
    if (sportTypes.length === 0) return;

    let hosts = await resolveHosts(ctx);
    let anyAnswered = false;
    // Claimed across every sport of this tick, so a viewer whose football and badminton picks start together get one mail.
    const claimed: SendJob[] = [];

    for (const [index, sportType] of sportTypes.entries()) {
      if (index > 0) await sleep(REQUEST_SPACING_MS);
      const result = await fetchFeed(hosts, sportType);
      if (result.kind === "failed") {
        console.warn(`[feed] sportType=${sportType} failed: ${result.error}`);
        continue;
      }
      anyAnswered = true;
      // The winning host moves to the front so the next tick starts there.
      if (hosts[0] !== result.host) {
        hosts = [result.host, ...hosts.filter((host) => host !== result.host)];
        await ctx.runMutation(internal.feedState.setHosts, { hosts });
      }
      if (result.kind === "empty") continue;

      const streaming = new Set(result.feed.streamIds);
      const rows: AlertRow[] = result.feed.rows.filter((row) => {
        if (!streaming.has(row.matchId)) return false;
        const hit = matchingChoices(row);
        const eligible = hit.clubs.length > 0 || hit.sports.length > 0;
        // Pin the series' competition ids from the first race weekend, then drop the name rule.
        if (eligible && (hit.sports.includes("f1") || hit.sports.includes("motogp"))) {
          console.log(`[feed] motorsport match ${row.matchId} competition=${row.competition?.id} name=${row.competition?.name} title=${row.title}`);
        }
        return eligible;
      });
      if (rows.length === 0) continue;

      const jobs = await ctx.runMutation(internal.sending.ingest, {
        now: Date.now(),
        rows: rows.map((row) => ({
          matchId: row.matchId,
          sportId: row.sportId,
          kickoffMs: row.kickoffMs,
          statusCode: row.statusCode,
          competition: row.competition === null ? null : { id: row.competition.id, name: row.competition.name },
          title: row.title,
          teams: row.teams.map((team) => ({ id: team.id, name: team.name })),
          slugs: row.slugs,
        })),
      });

      claimed.push(...jobs);
    }

    await sendJobs(ctx, claimed);

    // Every requested sport failed for real (499s count as answers): the whole family is down or rotated.
    if (!anyAnswered) await ctx.runMutation(internal.feedState.setHosts, { hosts: [] });
    const verdict = await ctx.runMutation(internal.feedState.record, { allFailed: !anyAnswered });
    if (verdict.mail === "down") {
      await operatorSend("Scoreline alerts: the feed is not answering", [
        `Every requested sport failed for ${verdict.streak} ticks in a row, so no alerts can go out.`,
        "Check the feed hosts (SCORELINE_ENTRY_HOSTS / SCORELINE_API_HOSTS in the Convex env) against docs/match-alerts.md.",
      ]);
    } else if (verdict.mail === "up") {
      await operatorSend("Scoreline alerts: the feed is answering again", ["The feed answered; alerts are flowing again."]);
    }
  },
});

// ---- the daily standings check ----

type Season = { id: number; startMs: number; endMs: number };

const walk = (fields: ProtoField[], visit: (message: ProtoField[]) => void, depth = 0): void => {
  if (depth > 12) return;
  visit(fields);
  for (const entry of fields) if (entry.nested) walk(entry.nested, visit, depth + 1);
};

/** The newest season in a season list: `{1: seasonId, 10: startMs, 11: endMs}`, current one first. */
const currentSeason = (bytes: Uint8Array, now: number): number | null => {
  const root = parseProto(bytes);
  if (root === null) return null;
  const seasons: Season[] = [];
  walk(root, (message) => {
    const id = message.find((entry) => entry.number === 1)?.varint;
    const startMs = message.find((entry) => entry.number === 10)?.varint;
    const endMs = message.find((entry) => entry.number === 11)?.varint;
    if (id != null && startMs != null && endMs != null) seasons.push({ id, startMs, endMs });
  });
  const running = seasons.filter((season) => season.startMs <= now && now <= season.endMs);
  const pool = running.length > 0 ? running : seasons.filter((season) => season.startMs <= now);
  return pool.sort((a, b) => b.startMs - a.startMs)[0]?.id ?? null;
};

/** Every id that sits at field 1 of some message in the standings tree. */
const teamIdsIn = (bytes: Uint8Array): Set<number> => {
  const ids = new Set<number>();
  const root = parseProto(bytes);
  if (root === null) return ids;
  walk(root, (message) => {
    const id = message.find((entry) => entry.number === 1)?.varint;
    if (id != null) ids.add(id);
  });
  return ids;
};

/**
 * Once a day: prune old rows, and tell the operator if a club's feed team id
 * has left its league table (the operator re-keyed teams) or if any mail's
 * outcome was never learned.
 */
export const daily = internalAction({
  args: {},
  handler: async (ctx) => {
    const now = Date.now();
    const { stuckSending } = await ctx.runMutation(internal.sending.maintain, { now });
    const problems: string[] = [];
    if (stuckSending > 0) problems.push(`${stuckSending} alert mail(s) are stuck in "sending": the answer from Brevo was lost, so they were not retried.`);

    const hosts = await resolveHosts(ctx);
    const leagueIds = [...new Set(CLUBS.map((club) => club.leagueId))];
    for (const [index, leagueId] of leagueIds.entries()) {
      if (index > 0) await sleep(REQUEST_SPACING_MS);
      const seasons = await fetchLeagueBytes(hosts, `/api/league/season/list?leagueId=${leagueId}&language=8&sportType=1`);
      const seasonId = seasons === null ? null : currentSeason(seasons, now);
      await sleep(REQUEST_SPACING_MS);
      const table =
        seasonId === null
          ? null
          : await fetchLeagueBytes(hosts, `/api/league/team/standing/list?leagueId=${leagueId}&seasonId=${seasonId}&language=8&sportType=1`);
      if (table === null) {
        problems.push(`Could not read the standings of league ${leagueId}, so its clubs' team ids were not checked.`);
        continue;
      }
      const present = teamIdsIn(table);
      for (const club of CLUBS.filter((candidate) => candidate.leagueId === leagueId)) {
        if (!present.has(club.teamId)) {
          problems.push(`${club.name} (team id ${club.teamId}) is no longer in league ${leagueId}'s table: the operator may have re-keyed teams.`);
        }
      }
    }

    if (problems.length > 0) await operatorSend("Scoreline alerts: daily check found problems", problems);
  },
});

/** Hourly: drop pairings that expired. */
export const sweepPairings = internalAction({
  args: {},
  handler: async (ctx) => {
    await ctx.runMutation(internal.pairing.sweep, {});
  },
});
