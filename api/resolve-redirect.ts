import { resolveRedirectEndpoint } from "../server/endpoints";

export const config = { runtime: "edge" };

export default function handler(request: Request): Promise<Response> {
  return resolveRedirectEndpoint(request);
}
