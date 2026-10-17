/**
 * The measured video quality of the source's stream servers.
 *
 * Why this table exists: their player is xgplayer over hls.js, and every
 * server answers a single MEDIA playlist - no master playlist, no
 * renditions, no adaptive bitrate (verified 2026-10-18, rig under
 * `scripts/stream-quality/`). Quality is therefore a fixed property of the
 * server the stream starts on, and their default pick is not their best one.
 * The video sits in a cross-origin frame, so quality can never be read at
 * watch time: the only source of knowledge is our own measurements, and this
 * module is those measurements.
 *
 * Honesty rules:
 * - One row per measured fact. No row without a measurement behind it.
 * - Each row names the date and the match it was measured on, so the next
 *   agent can tell a fresh fact from a standing hypothesis.
 * - Unknown is a first-class answer (`null`), never a guess.
 * - Rows are exact labels (matched case-insensitively after trimming).
 *   Widen a row to a family pattern (for example every `DZ xx` label) only
 *   when at least two different labels of the family measured the same.
 */

/** A measured decoded quality: height in pixels plus frame rate. */
export type StreamQuality = {
  height: number;
  fps: number;
};

type MeasuredRow = {
  /** The server label exactly as the source's stream list prints it. */
  label: string;
  quality: StreamQuality;
  /** Provenance: when and on which match this was measured. */
  measured: string;
};

/**
 * The measured rows. The Telstar six (2026-10-18) showed their default (1X,
 * first in their list) was the worst decode of the match; Movistar2 was
 * measured on the basketball fixture the same night. Re-measure before
 * widening; one match is one data point.
 */
const MEASURED: readonly MeasuredRow[] = [
  {
    label: "1X",
    quality: { height: 540, fps: 25 },
    measured: "2026-10-18, SC Telstar v Feyenoord 4416238",
  },
  {
    label: "Mo TH",
    quality: { height: 540, fps: 25 },
    measured: "2026-10-18, SC Telstar v Feyenoord 4416238",
  },
  {
    label: "DZ FR",
    quality: { height: 720, fps: 25 },
    measured: "2026-10-18, SC Telstar v Feyenoord 4416238",
  },
  {
    label: "DZ PT",
    quality: { height: 720, fps: 25 },
    measured: "2026-10-18, SC Telstar v Feyenoord 4416238",
  },
  {
    label: "TyR",
    quality: { height: 720, fps: 25 },
    measured: "2026-10-18, SC Telstar v Feyenoord 4416238",
  },
  {
    label: "ESPN MX",
    quality: { height: 720, fps: 60 },
    measured: "2026-10-18, SC Telstar v Feyenoord 4416238",
  },
  {
    label: "Movistar2",
    quality: { height: 576, fps: 25 },
    measured: "2026-10-18, San Pablo Burgos v Monbus Obradoiro 2246732",
  },
];

/**
 * The quality measured for a server label, or null when never measured.
 * Labels match case-insensitively after trimming; unknown stays unknown.
 */
export const streamQuality = (label: string): StreamQuality | null => {
  const key = label.trim().toLowerCase();
  const row = MEASURED.find((row) => row.label.toLowerCase() === key);
  return row === undefined ? null : row.quality;
};

/**
 * The quality ordering: height first, then frame rate.
 * Positive when `a` is strictly better than `b`, zero when equal.
 */
export const compareQuality = (a: StreamQuality, b: StreamQuality): number =>
  a.height - b.height || a.fps - b.fps;

/**
 * The short chip badge for a measured quality: `720p60`, `720p`, `540p`.
 * The frame rate only shows when it is a genuinely smooth one (>30).
 */
export const qualityBadge = (quality: StreamQuality): string =>
  quality.fps > 30 ? `${quality.height}p${quality.fps}` : `${quality.height}p`;

/**
 * The best measured option of a stream list, or null when nothing in it was
 * ever measured. Takes anything carrying the stream label (`StreamOption`).
 */
export const bestMeasured = <T extends { name: string }>(
  streams: readonly T[],
): { stream: T; quality: StreamQuality } | null => {
  let best: { stream: T; quality: StreamQuality } | null = null;
  for (const stream of streams) {
    const quality = streamQuality(stream.name);
    if (quality === null) continue;
    if (best === null || compareQuality(quality, best.quality) > 0) {
      best = { stream, quality };
    }
  }
  return best;
};