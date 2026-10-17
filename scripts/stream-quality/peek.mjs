// Open the harness, wait, then evaluate an expression in every frame whose host matches --host.
// node peek.mjs --url <harness> --wait 12 --host player --expr '<js>'
const args = Object.fromEntries(
  process.argv.slice(2).reduce((acc, cur, i, all) => (cur.startsWith("--") ? [...acc, [cur.slice(2), all[i + 1]]] : acc), []),
);
const version = await (await fetch("http://127.0.0.1:9222/json/version")).json();
const ws = new WebSocket(version.webSocketDebuggerUrl);
await new Promise((r) => ws.addEventListener("open", r, { once: true }));
let id = 1;
const pending = new Map();
const sessions = new Map();
ws.addEventListener("message", async (e) => {
  const m = JSON.parse(e.data);
  if (m.id && pending.has(m.id)) {
    const p = pending.get(m.id);
    pending.delete(m.id);
    m.error ? p.reject(new Error(m.error.message)) : p.resolve(m.result);
  } else if (m.method === "Target.attachedToTarget") {
    sessions.set(m.params.sessionId, m.params.targetInfo);
    await prep(m.params.sessionId);
  }
});
const send = (method, params = {}, sessionId) =>
  new Promise((resolve, reject) => {
    const n = id++;
    pending.set(n, { resolve, reject });
    ws.send(JSON.stringify({ id: n, method, params, ...(sessionId ? { sessionId } : {}) }));
  });
const prep = async (s) => {
  await send("Runtime.enable", {}, s).catch(() => {});
  await send("Target.setAutoAttach", { autoAttach: true, waitForDebuggerOnStart: true, flatten: true }, s).catch(() => {});
  await send("Runtime.runIfWaitingForDebugger", {}, s).catch(() => {});
};
const { targetId } = await send("Target.createTarget", { url: "about:blank" });
const { sessionId: page } = await send("Target.attachToTarget", { targetId, flatten: true });
await prep(page);
await send("Emulation.setDeviceMetricsOverride", { width: 1700, height: 1000, deviceScaleFactor: 1, mobile: false }, page);
await send("Page.navigate", { url: args.url }, page);
await new Promise((r) => setTimeout(r, Number(args.wait ?? 12) * 1000));
for (const [s, info] of sessions) {
  const res = await send("Runtime.evaluate", { expression: `location.host`, returnByValue: true }, s).catch(() => null);
  const host = res?.result?.value ?? "";
  if (!host.includes(args.host ?? "")) continue;
  const out = await send("Runtime.evaluate", { expression: args.expr, returnByValue: true, awaitPromise: true }, s).catch((e) => ({ error: e.message }));
  console.log(info.type, host, JSON.stringify(out.result?.value ?? out, null, 1));
}
if (args.keep !== "1") await send("Target.closeTarget", { targetId });
ws.close();
