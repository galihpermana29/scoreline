import { ConvexReactClient } from "convex/react";

const url: string | undefined = import.meta.env.VITE_CONVEX_URL;
if (!url) throw new Error("VITE_CONVEX_URL is not set: Scoreline needs its Convex deployment for accounts (see docs/match-alerts.md).");

/** One client for the app. It connects at startup because the gate needs the session state right away. */
export const convex = new ConvexReactClient(url);
