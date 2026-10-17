/* eslint-disable */
/**
 * Generated `api` utility.
 *
 * THIS CODE IS AUTOMATICALLY GENERATED.
 *
 * To regenerate, run `npx convex dev`.
 * @module
 */

import type * as alerts from "../alerts.js";
import type * as auth from "../auth.js";
import type * as brevo from "../brevo.js";
import type * as crons from "../crons.js";
import type * as feed from "../feed.js";
import type * as feedState from "../feedState.js";
import type * as http from "../http.js";
import type * as mail from "../mail.js";
import type * as pairing from "../pairing.js";
import type * as sending from "../sending.js";
import type * as signing from "../signing.js";
import type * as source from "../source.js";
import type * as unsubscribe from "../unsubscribe.js";

import type {
  ApiFromModules,
  FilterApi,
  FunctionReference,
} from "convex/server";

declare const fullApi: ApiFromModules<{
  alerts: typeof alerts;
  auth: typeof auth;
  brevo: typeof brevo;
  crons: typeof crons;
  feed: typeof feed;
  feedState: typeof feedState;
  http: typeof http;
  mail: typeof mail;
  pairing: typeof pairing;
  sending: typeof sending;
  signing: typeof signing;
  source: typeof source;
  unsubscribe: typeof unsubscribe;
}>;

/**
 * A utility for referencing Convex functions in your app's public API.
 *
 * Usage:
 * ```js
 * const myFunctionReference = api.myModule.myFunction;
 * ```
 */
export declare const api: FilterApi<
  typeof fullApi,
  FunctionReference<any, "public">
>;

/**
 * A utility for referencing Convex functions in your app's internal API.
 *
 * Usage:
 * ```js
 * const myFunctionReference = internal.myModule.myFunction;
 * ```
 */
export declare const internal: FilterApi<
  typeof fullApi,
  FunctionReference<any, "internal">
>;

export declare const components: {};
