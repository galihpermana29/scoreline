/** HMAC signing for the unsubscribe link: the signature is over the user id, keyed by UNSUBSCRIBE_SECRET. */

const encoder = new TextEncoder();

const key = async (usage: "sign" | "verify"): Promise<CryptoKey> => {
  const secret = process.env.UNSUBSCRIBE_SECRET;
  if (!secret) throw new Error("UNSUBSCRIBE_SECRET is not set.");
  return crypto.subtle.importKey("raw", encoder.encode(secret), { name: "HMAC", hash: "SHA-256" }, false, [usage]);
};

const toHex = (bytes: ArrayBuffer): string =>
  [...new Uint8Array(bytes)].map((byte) => byte.toString(16).padStart(2, "0")).join("");

const fromHex = (hex: string): Uint8Array<ArrayBuffer> | null => {
  if (!/^(?:[0-9a-f]{2})+$/i.test(hex)) return null;
  const bytes = new Uint8Array(new ArrayBuffer(hex.length / 2));
  for (let index = 0; index < bytes.length; index += 1) bytes[index] = Number.parseInt(hex.slice(index * 2, index * 2 + 2), 16);
  return bytes;
};

export const signUser = async (userId: string): Promise<string> =>
  toHex(await crypto.subtle.sign("HMAC", await key("sign"), encoder.encode(userId)));

/** Constant-time check, via the platform's own verify. */
export const verifyUser = async (userId: string, signature: string): Promise<boolean> => {
  const bytes = fromHex(signature);
  if (bytes === null) return false;
  return crypto.subtle.verify("HMAC", await key("verify"), bytes, encoder.encode(userId));
};

export const sha256Hex = async (value: string): Promise<string> =>
  toHex(await crypto.subtle.digest("SHA-256", encoder.encode(value)));
