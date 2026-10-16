import { probePlayerEndpoint } from "../server/endpoints";

export const config = { runtime: "edge" };

export default function handler(request: Request): Promise<Response> {
  return probePlayerEndpoint(request);
}
