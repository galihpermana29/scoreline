import { internal } from "./_generated/api";
import type { Id } from "./_generated/dataModel";
import { httpAction } from "./_generated/server";
import { verifyUser } from "./signing";

const page = (status: number, headline: string, detail: string): Response =>
  new Response(
    `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Scoreline alerts</title></head>
<body style="margin:0;display:grid;place-items:center;min-height:100vh;background:#0b0b0d;color:#f2f2f4;font-family:-apple-system,Segoe UI,Roboto,sans-serif">
<main style="max-width:360px;padding:24px;text-align:center"><h1 style="margin:0 0 8px;font-size:20px">${headline}</h1><p style="margin:0;color:#9a9aa3;font-size:15px;line-height:1.5">${detail}</p></main></body></html>`,
    { status, headers: { "content-type": "text/html; charset=utf-8", "cache-control": "no-store" } },
  );

/** Clears every alert choice for the signed link's viewer. No sign-in: the HMAC of the user id is the proof. */
export const unsubscribe = httpAction(async (ctx, request) => {
  const url = new URL(request.url);
  const userId = url.searchParams.get("u");
  const signature = url.searchParams.get("s");
  if (!userId || !signature || !(await verifyUser(userId, signature))) {
    return page(400, "This link is not valid", "Open Scoreline and turn alerts off from the bell instead.");
  }
  await ctx.runMutation(internal.alerts.clearAll, { userId: userId as Id<"users"> });
  // One-click clients POST and ignore the body; a person following the footer link sees the confirmation.
  return page(200, "All alerts are off", "You will not get any more Live now mails. You can turn alerts back on from the bell in Scoreline.");
});
