import { configEndpoint } from "../server/endpoints";

export const config = { runtime: "edge" };

export default function handler(): Response {
  return configEndpoint();
}
