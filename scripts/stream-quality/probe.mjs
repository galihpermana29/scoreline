// Video-quality probe: opens the harness in a CDP browser, auto-attaches to
// every nested frame (mirror -> player), records HLS playlists and samples
// the <video> elements' real decoded size over time.
//
// node probe.mjs --url <harness url> --secs 60 --out run.json [--switch '<json si>' --switchAt 40]
import { writeFileSync } from "node:fs";

const args = Object.fromEntries(
  process.argv.slice(2).reduce((acc, cur, i, all) => (cur.startsWith("--") ? [...acc, [cur.slice(2), all[i + 1]]] : acc), []),
);
const PORT = Number(args.port ?? 9222);
const SECS = Number(args.secs ?? 60);
const switches = args.switch ? JSON.parse(args.switch) : [];
const SWITCH_EVERY = Number(args.switchEvery ?? 30);

const version = await (await fetch(`http://127.0.0.1:${PORT}/json/version`)).json();
const ws = new WebSocket(version.webSocketDebuggerUrl);
await new Promise((resolve) => ws.addEventListener("open", resolve, { once: true }));

let nextId = 1;
const pending = new Map();
const handlers = [];
ws.addEventListener("message", (event) => {
  const msg = JSON.parse(event.data);
  if (msg.id && pending.has(msg.id)) {
    const { resolve, reject } = pending.get(msg.id);
    pending.delete(msg.id);
    msg.error ? reject(new Error(msg.error.message)) : resolve(msg.result);
    return;
  }
  for (const handler of handlers) handler(msg);
});
const send = (method, params = {}, sessionId) =>
  new Promise((resolve, reject) => {
    const id = nextId++;
    pending.set(id, { resolve, reject });
    ws.send(JSON.stringify({ id, method, params, ...(sessionId ? { sessionId } : {}) }));
  });

const sessions = new Map(); // sessionId -> { type, url }
const playlists = []; // { t, session, url, body }
const media = new Map(); // url prefix -> count
const started = Date.now();
const t = () => Math.round((Date.now() - started) / 100) / 10;

const prepare = async (sessionId) => {
  await send("Runtime.enable", {}, sessionId).catch(() => {});
  await send("Network.enable", {}, sessionId).catch(() => {});
  await send("Target.setAutoAttach", { autoAttach: true, waitForDebuggerOnStart: true, flatten: true }, sessionId).catch(() => {});
  await send("Runtime.runIfWaitingForDebugger", {}, sessionId).catch(() => {});
};

const reqUrls = new Map();
handlers.push(async (msg) => {
  if (msg.method === "Target.attachedToTarget") {
    const { sessionId, targetInfo } = msg.params;
    sessions.set(sessionId, { type: targetInfo.type, url: targetInfo.url });
    await prepare(sessionId);
  }
  if (msg.method === "Network.requestWillBeSent") {
    reqUrls.set(msg.params.requestId, msg.params.request.url);
  }
  if (msg.method === "Network.responseReceived") {
    const { response, requestId } = msg.params;
    const url = response.url;
    const mime = response.mimeType || "";
    if (/m3u8/i.test(url) || /mpegurl/i.test(mime)) {
      playlists.push({ t: t(), session: msg.sessionId, url, requestId, mime, status: response.status });
    } else if (/\.(ts|m4s|mp4|aac|m4a|json)(\?|$)/i.test(url) || /video\/|mp2t/i.test(mime)) {
      const key = `${new URL(url).host} ${response.status} ${mime}`;
      media.set(key, (media.get(key) ?? 0) + 1);
    }
  }
  if (msg.method === "Network.loadingFailed") {
    const url = reqUrls.get(msg.params.requestId) ?? "?";
    if (/token-|\.json|m3u8|\.ts/.test(url)) {
      const key = `FAILED ${new URL(url).host} ${msg.params.errorText} ${msg.params.blockedReason ?? ""}`;
      media.set(key, (media.get(key) ?? 0) + 1);
    }
  }
  if (msg.method === "Network.loadingFinished") {
    const pl = playlists.find((p) => p.requestId === msg.params.requestId && p.session === msg.sessionId && p.body === undefined);
    if (pl) {
      try {
        const res = await send("Network.getResponseBody", { requestId: pl.requestId }, msg.sessionId);
        pl.body = res.base64Encoded ? Buffer.from(res.body, "base64").toString("utf8") : res.body;
      } catch (error) {
        pl.body = `<<${error.message}>>`;
      }
    }
  }
});

const SAMPLE = `(() => {
  const vs = [...document.querySelectorAll('video')];
  const hlsLike = [];
  try {
    for (const key of Object.getOwnPropertyNames(window)) {
      let top; try { top = window[key]; } catch { continue; }
      if (!top || typeof top !== 'object') continue;
      const cands = [[key, top]];
      try { for (const k2 of Object.keys(top).slice(0, 80)) { const v2 = top[k2]; if (v2 && typeof v2 === 'object') cands.push([key + '.' + k2, v2]); } } catch {}
      for (const [path, v] of cands) {
        if (Array.isArray(v.levels) && 'currentLevel' in v) {
          hlsLike.push({ path, currentLevel: v.currentLevel, nextAuto: v.nextAutoLevel, autoLevelCapping: v.autoLevelCapping, cap: v.config && v.config.capLevelToPlayerSize, levels: v.levels.map(l => (l.width||'?') + 'x' + (l.height||'?') + '@' + Math.round((l.bitrate||0)/1000) + 'k') });
        }
      }
    }
  } catch {}
  return {
    host: location.host, path: location.pathname, dpr: devicePixelRatio, iw: innerWidth, ih: innerHeight,
    hlsGlobal: typeof Hls !== 'undefined' ? { version: Hls.version, cap: Hls.DefaultConfig && Hls.DefaultConfig.capLevelToPlayerSize } : null,
    hlsLike,
    videos: vs.map(v => ({ vw: v.videoWidth, vh: v.videoHeight, cw: v.clientWidth, ch: v.clientHeight, paused: v.paused, time: Math.round(v.currentTime), ready: v.readyState,
      dropped: v.getVideoPlaybackQuality ? v.getVideoPlaybackQuality().droppedVideoFrames : null,
      total: v.getVideoPlaybackQuality ? v.getVideoPlaybackQuality().totalVideoFrames : null,
      src: (v.currentSrc || '').slice(0, 80) })),
  };
})()`;

await send("Target.setDiscoverTargets", { discover: true });
const { targetId } = await send("Target.createTarget", { url: "about:blank" });
const { sessionId: page } = await send("Target.attachToTarget", { targetId, flatten: true });
sessions.set(page, { type: "page", url: args.url });
await send("Page.enable", {}, page);
await prepare(page);
await send("Emulation.setDeviceMetricsOverride", { width: Number(args.vw ?? 1700), height: Number(args.vh ?? 1000), deviceScaleFactor: Number(args.dsf ?? 1), mobile: false }, page);
await send("Page.navigate", { url: args.url }, page);

const samples = [];
const clickCenter = async () => {
  const w = Number(new URL(args.url).searchParams.get("w") ?? 1600);
  const x = w / 2, y = (w * 9) / 16 / 2;
  for (const type of ["mousePressed", "mouseReleased"]) {
    await send("Input.dispatchMouseEvent", { type, x, y, button: "left", clickCount: 1 }, page).catch(() => {});
  }
};

let switchIndex = 0;
for (let second = 5; second <= SECS; second += 5) {
  await new Promise((resolve) => setTimeout(resolve, 5000));
  if (second >= 10 && second <= 30 && args.click !== "0") {
    for (const [sessionId, info] of sessions) {
      if (info.type !== "iframe") continue;
      await send("Runtime.evaluate", { expression: `(() => { if (document.querySelector('video')) return 'has-video'; const b = document.querySelector('.xgplayer-start'); if (b) { b.click(); return 'clicked'; } return 'none'; })()`, returnByValue: true }, sessionId).catch(() => {});
    }
  }
  if (switches.length > 0 && second % SWITCH_EVERY === 0 && switchIndex < switches.length) {
    const si = switches[switchIndex++];
    const res = await send("Runtime.evaluate", { expression: `window.__switch(${JSON.stringify(si)})`, returnByValue: true }, page).catch((e) => ({ error: e.message }));
    samples.push({ t: t(), switchedTo: si.name, delivered: res?.result?.value ?? res });
  }
  const round = { t: t(), frames: [] };
  for (const [sessionId, info] of sessions) {
    if (info.type !== "iframe" && info.type !== "page") continue;
    try {
      const res = await send("Runtime.evaluate", { expression: SAMPLE, returnByValue: true }, sessionId);
      const v = res.result.value;
      if (args.debug) console.log("   ", info.type, v ? `${v.host}${v.path} videos=${v.videos.length} hls=${!!v.hlsGlobal}` : JSON.stringify(res).slice(0, 160));
      if (v && (v.videos.length > 0 || v.hlsLike.length > 0 || v.hlsGlobal)) round.frames.push(v);
    } catch (error) {
      if (args.debug) console.log("   ", info.type, "eval failed", error.message);
    }
  }
  samples.push(round);
  if (args.shots && second % 15 === 0) {
    const shot = await send("Page.captureScreenshot", { format: "png" }, page).catch(() => null);
    if (shot) writeFileSync(`${args.shots}-${second}.png`, Buffer.from(shot.data, "base64"));
  }
  const brief = round.frames.flatMap((f) => f.videos.map((v) => `${f.host} dpr${f.dpr} box${v.cw}x${v.ch} decoded${v.vw}x${v.vh} t${v.time}${v.paused ? " paused" : ""}`));
  console.log(`[${round.t}s]`, brief.join(" | ") || "(no video yet)");
}

const out = {
  url: args.url,
  samples,
  playlists: playlists.map(({ requestId, ...rest }) => rest),
  media: Object.fromEntries(media),
  frames: [...sessions.values()],
};
writeFileSync(args.out ?? "run.json", JSON.stringify(out, null, 2));
await send("Target.closeTarget", { targetId }).catch(() => {});
ws.close();
console.log("playlists:", playlists.length, "media prefixes:", media.size);
