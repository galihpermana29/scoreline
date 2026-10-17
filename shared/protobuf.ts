/**
 * Minimal protobuf wire-format parser, sufficient for reading messages whose
 * .proto schema is unknown. Field numbers and nesting come from observed
 * payloads rather than a schema file.
 */

export type Wire = 0 | 1 | 2 | 5;

export type ProtoField = {
  number: number;
  wire: Wire;
  /** Varint / fixed payload as a number. Millisecond timestamps fit in 53 bits. */
  varint: number | null;
  /** Length-delimited payload, wire type 2. */
  bytes: Uint8Array | null;
  /** Wire type 2 payload parsed as a nested message, when it parses cleanly. */
  nested: ProtoField[] | null;
};

export const parseProto = (bytes: Uint8Array): ProtoField[] | null => {
  const fields: ProtoField[] = [];
  let pos = 0;

  const readVarint = (): number | null => {
    let result = 0;
    let shift = 0;
    for (;;) {
      if (pos >= bytes.length) return null;
      const byte = bytes[pos]!;
      pos += 1;
      // Low 7 bits carry the value; bit 0x80 is only the continuation flag.
      result += (byte & 0x7f) * 2 ** shift;
      if (byte < 0x80) return result;
      shift += 7;
      if (shift > 63) return null;
    }
  };

  while (pos < bytes.length) {
    const tag = readVarint();
    if (tag === null) return null;
    const number = Math.floor(tag / 8);
    const wire = tag % 8;
    if (number === 0) return null;

    if (wire === 0) {
      const value = readVarint();
      if (value === null) return null;
      fields.push({ number, wire, varint: value, bytes: null, nested: null });
    } else if (wire === 2) {
      const length = readVarint();
      if (length === null || pos + length > bytes.length) return null;
      const slice = bytes.subarray(pos, pos + length);
      pos += length;
      fields.push({ number, wire, varint: null, bytes: slice, nested: parseProto(slice) });
    } else if (wire === 1) {
      if (pos + 8 > bytes.length) return null;
      let value = 0;
      for (let index = 7; index >= 0; index -= 1) value = value * 256 + (bytes[pos + index] ?? 0);
      pos += 8;
      fields.push({ number, wire, varint: value, bytes: null, nested: null });
    } else if (wire === 5) {
      if (pos + 4 > bytes.length) return null;
      let value = 0;
      for (let index = 3; index >= 0; index -= 1) value = value * 256 + (bytes[pos + index] ?? 0);
      pos += 4;
      fields.push({ number, wire, varint: value, bytes: null, nested: null });
    } else {
      // Group wire types (3, 4) are deprecated and not produced by this API.
      return null;
    }
  }

  return fields;
};

// ---- readers, by field number ----

const decode = new TextDecoder("utf-8", { fatal: false });

export const field = (message: ProtoField[], number: number): ProtoField | undefined =>
  message.find((entry) => entry.number === number);

export const fields = (message: ProtoField[], number: number): ProtoField[] =>
  message.filter((entry) => entry.number === number);

/** First varint/fixed value of `number`, or null. */
export const num = (message: ProtoField[], number: number): number | null => {
  const entry = field(message, number);
  return entry?.varint ?? null;
};

/** First length-delimited value of `number` decoded as trimmed UTF-8 text. */
export const text = (message: ProtoField[], number: number): string | null => {
  const entry = field(message, number);
  if (!entry?.bytes) return null;
  const value = decode.decode(entry.bytes).trim();
  return value === "" ? null : value;
};

/** All length-delimited values of `number` decoded as text. */
export const texts = (message: ProtoField[], number: number): string[] =>
  fields(message, number)
    .flatMap((entry) => (entry.bytes ? [decode.decode(entry.bytes)] : []))
    .map((value) => value.trim())
    .filter((value) => value !== "");

/** First nested message at `number`, or null. */
export const sub = (message: ProtoField[], number: number): ProtoField[] | null => {
  const entry = field(message, number);
  return entry?.nested ?? null;
};

/** Every nested message at `number`. */
export const subs = (message: ProtoField[], number: number): ProtoField[][] =>
  fields(message, number).flatMap((entry) => (entry.nested ? [entry.nested] : []));