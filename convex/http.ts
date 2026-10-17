import { httpRouter } from "convex/server";
import { auth } from "./auth";
import { unsubscribe } from "./unsubscribe";

const http = httpRouter();

auth.addHttpRoutes(http);

// GET for the footer link, POST for the mail clients' one-click button
// (List-Unsubscribe-Post): both clear the viewer's choices without sign-in.
http.route({ path: "/unsubscribe", method: "GET", handler: unsubscribe });
http.route({ path: "/unsubscribe", method: "POST", handler: unsubscribe });

export default http;
