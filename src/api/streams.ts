import { LANGUAGE, fetchDataHostBytes } from "./aelive";
import { num, parseProto, sub, subs, text } from "../../shared/protobuf";

/**
 * The source's per-match stream ("server") list and the postMessage contract
 * that switches servers inside the page embed (everything verified live on an
 * Everton-Chelsea Premier League fixture, 2026-10-17 - full notes in
 * AGENTS.md under the dated facts).
 *
 * The list: their `/api/match/detail` (same rotating data hosts as the live
 * feed, same open CORS, same ignored `sfver` placeholder segment) answers a
 * protobuf envelope whose data block (root field 10) carries one field-2
 * entry per stream channel - {1: streamId, 2: sportType, 3: label, 9:
 * siteType, 50: matchId} plus a second site-ish code at field 8 that is NOT
 * the switch's siteType (verified live 2026-10-17: their own switch fetches
 * stream/detail with siteType=2001 - field 9 - and the field-8 value gets
 * "Stream Not Found"). For the verified fixture the eleven entries decoded
 * in order to exactly the labels their own mirror page renders below the
 * video ("1X EN", "TD EN", "Fubo US", "Movistar2", "Now IT", "Cal FR",
 * "TD Arabic", "DZ PT", "Mo TH", "TyR", "8X VN"), so this is the same list
 * their UI shows, read as data. Entries exist well before kick-off, so the
 * chips render as soon as the watch embed starts.
 *
 * The switch: their mirror page and its nested player talk postMessage -
 * the server buttons on the mirror post the chosen channel object down to
 * the player as
 * `{msgEventType: "FROM_PARENT_SITE", val: {evType: 104, _si: <channel>}}`
 * (`evType` 104 = EV_PLAYER_DATA in their own bundle, and the player's
 * receiveParent checks only `evType` and `_si` - it accepts the message from
 * any window except itself, no origin check). The player then refetches
 * `/api/stream/detail` for the new streamId and re-arms its video, and pushes
 * the new selection back up so the mirror's own highlight follows.
 *
 * We are the grandparent in page mode (app -> mirror -> player), but
 * cross-origin frame walking (`win.frames[i]`) is in the browser's
 * cross-origin-allowed window properties, so the same message reaches the
 * player from us: verified live - the framed switch moved both the player
 * (its loading state) and the mirror's own server-row highlight to our
 * chosen channel.
 */

/** One stream channel of a match, e.g. {streamId: 870120, name: "Fubo US"}. */
export type StreamOption = {
  /** The channel id their player passes to /api/stream/detail. */
  streamId: number;
  sportType: number;
  /** Display label, e.g. "1X EN". */
  name: string;
  /** Their site-category code for the channel; rides the switch payload. */
  siteType: number | null;
};

const DETAIL_PATH = "/api/match/detail";

/**
 * The stream channels of a match, in the source's own order. Empty when the
 * endpoint is unreachable or answers nothing - the feature degrades to "no
 * chips", never to a broken watch page.
 */
export const fetchMatchStreams = async (matchId: number, sportType: number): Promise<StreamOption[]> => {
  const buffer = await fetchDataHostBytes(
    DETAIL_PATH,
    `matchId=${matchId}&language=${LANGUAGE}&sportType=${sportType}&usls=rbp`,
  );
  const root = parseProto(buffer);
  if (root === null) return [];
  const data = sub(root, 10);
  if (data === null) return [];
  return subs(data, 2).flatMap((entry) => {
    const streamId = num(entry, 1);
    const name = text(entry, 3);
    if (streamId === null || name === null) return [];
    return [
      {
        streamId,
        sportType: num(entry, 2) ?? sportType,
        name,
        // Field 9, NOT field 8: the entry carries two site-ish codes, and
        // their own switch posts field 9's value (e.g. 2001) as `siteType` -
        // verified live 2026-10-17: `/api/stream/detail?...&siteType=2001`
        // answers the encrypted stream blob while `siteType=2` (field 8)
        // answers "Stream Not Found", which reads as an endless spinner
        // because their player only logs the failed refetch.
        siteType: num(entry, 9),
      },
    ];
  });
};

/** Their EV_PLAYER_DATA - the postMessage event type that carries a stream change. */
const EV_PLAYER_DATA = 104;

/**
 * Ask the page embed to switch its live stream channel. Walks the embed's
 * frame tree and posts the same message their own server buttons use to every
 * frame: only the nested player listens (verified live 2026-10-17 - the
 * steady mirror page has exactly one child frame, the player; ad frames
 * ignore the message shape), and the mirror's own server row re-highlights
 * from the player's reply, so our external control never desyncs their UI.
 *
 * No confirmation channel exists back to us, so this returns only whether the
 * message could be delivered (found and reached at least one frame). If
 * their player auto-advances the channel on its own later (their
 * fail-on-invalid flow), nothing reports that upward in page mode - our
 * chip highlight tracks the last choice made from this app, and their UI
 * inside the frame remains the source of truth. See AGENTS.md.
 */
export const postStreamSwitch = (embed: HTMLIFrameElement, stream: StreamOption): boolean => {
  const mirror = embed.contentWindow;
  if (mirror === null) return false;
  // `frames`, `length`, and `postMessage` are the cross-origin-allowed window
  // properties; a denied access (odd embedders, swapped document mid-walk)
  // degrades to "not delivered" rather than breaking the watch screen.
  let delivered = 0;
  try {
    const payload = {
      msgEventType: "FROM_PARENT_SITE",
      val: {
        evType: EV_PLAYER_DATA,
        // The channel as their own buttons post it, plus oriName: their
        // switch code copies label = oriName before fetching the new stream.
        _si: { ...stream, oriName: stream.name },
      },
    };
    for (let index = 0; index < mirror.length; index++) {
      mirror.frames[index]?.postMessage(payload, "*");
      delivered += 1;
    }
  } catch {
    return false;
  }
  return delivered > 0;
};