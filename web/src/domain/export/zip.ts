// Minimal ZIP writer (no ZIP64) + deflate-raw helpers on the native Compression Streams API.
// Works in browsers and Node 24; no DOM access.

export interface ZipEntry {
  /** Path inside the archive, "/" separated (stored as UTF-8). */
  name: string;
  data: Uint8Array;
}

export interface ZipOptions {
  /** Deflate entries (default true); an entry is stored when deflate would not make it smaller. */
  compress?: boolean;
  /** Modification time written for every entry (default: now). */
  date?: Date;
}

async function readAll(stream: ReadableStream<Uint8Array>, maxBytes: number): Promise<Uint8Array> {
  const reader = stream.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    total += value.byteLength;
    if (total > maxBytes) {
      reader.cancel().catch(() => undefined);
      throw new Error(`Data exceeds the limit of ${maxBytes} bytes.`);
    }
    chunks.push(value);
  }
  return concatBytes(chunks, total);
}

export function concatBytes(chunks: Uint8Array[], total?: number): Uint8Array {
  const size = total ?? chunks.reduce((n, c) => n + c.byteLength, 0);
  const out = new Uint8Array(size);
  let offset = 0;
  for (const c of chunks) {
    out.set(c, offset);
    offset += c.byteLength;
  }
  return out;
}

/** Raw DEFLATE (RFC 1951) via CompressionStream("deflate-raw"). */
export async function deflateRaw(data: Uint8Array): Promise<Uint8Array> {
  const stream = new Blob([data]).stream().pipeThrough(new CompressionStream("deflate-raw"));
  return readAll(stream, Number.POSITIVE_INFINITY);
}

/** Inverse of deflateRaw; rejects on corrupt input or when the output exceeds `maxBytes`. */
export async function inflateRaw(data: Uint8Array, maxBytes = Number.POSITIVE_INFINITY): Promise<Uint8Array> {
  const stream = new Blob([data]).stream().pipeThrough(new DecompressionStream("deflate-raw"));
  return readAll(stream, maxBytes);
}

let crcTable: Uint32Array | undefined;

/** CRC-32 (IEEE 802.3), as used by ZIP. */
export function crc32(data: Uint8Array): number {
  if (!crcTable) {
    crcTable = new Uint32Array(256);
    for (let n = 0; n < 256; n++) {
      let c = n;
      for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
      crcTable[n] = c >>> 0;
    }
  }
  let crc = 0xffffffff;
  for (let i = 0; i < data.length; i++) crc = crcTable[(crc ^ data[i]) & 0xff] ^ (crc >>> 8);
  return (crc ^ 0xffffffff) >>> 0;
}

function dosDateTime(d: Date): { time: number; date: number } {
  const year = d.getFullYear();
  if (Number.isNaN(year) || year < 1980) return { time: 0, date: (1 << 5) | 1 };
  return {
    time: (d.getHours() << 11) | (d.getMinutes() << 5) | Math.floor(d.getSeconds() / 2),
    date: ((Math.min(year, 2107) - 1980) << 9) | ((d.getMonth() + 1) << 5) | d.getDate(),
  };
}

const UTF8_FLAG = 0x0800;
const METHOD_STORE = 0;
const METHOD_DEFLATE = 8;
const VERSION = 20;

/** Builds a ZIP archive (local headers, central directory, CRC-32, UTF-8 names). */
export async function createZip(entries: ZipEntry[], options: ZipOptions = {}): Promise<Uint8Array> {
  const compress = options.compress ?? true;
  const { time, date } = dosDateTime(options.date ?? new Date());
  const encoder = new TextEncoder();
  if (entries.length > 0xffff) throw new Error("Too many ZIP entries.");
  const seen = new Set<string>();

  const parts: Uint8Array[] = [];
  const central: Uint8Array[] = [];
  let offset = 0;

  for (const entry of entries) {
    const name = entry.name.replace(/\\/g, "/").replace(/^\/+/, "");
    if (!name) throw new Error("ZIP entry without a name.");
    if (seen.has(name)) throw new Error(`Duplicate ZIP entry "${name}".`);
    seen.add(name);
    const nameBytes = encoder.encode(name);
    const crc = crc32(entry.data);
    let method = METHOD_STORE;
    let body = entry.data;
    if (compress && entry.data.byteLength > 0) {
      const deflated = await deflateRaw(entry.data);
      if (deflated.byteLength < entry.data.byteLength) {
        method = METHOD_DEFLATE;
        body = deflated;
      }
    }
    if (body.byteLength > 0xfffffffe || entry.data.byteLength > 0xfffffffe || offset > 0xfffffffe) {
      throw new Error("ZIP archive too large (ZIP64 is not supported).");
    }

    const local = new Uint8Array(30 + nameBytes.byteLength);
    const lv = new DataView(local.buffer);
    lv.setUint32(0, 0x04034b50, true);
    lv.setUint16(4, VERSION, true);
    lv.setUint16(6, UTF8_FLAG, true);
    lv.setUint16(8, method, true);
    lv.setUint16(10, time, true);
    lv.setUint16(12, date, true);
    lv.setUint32(14, crc, true);
    lv.setUint32(18, body.byteLength, true);
    lv.setUint32(22, entry.data.byteLength, true);
    lv.setUint16(26, nameBytes.byteLength, true);
    lv.setUint16(28, 0, true);
    local.set(nameBytes, 30);

    const cd = new Uint8Array(46 + nameBytes.byteLength);
    const cv = new DataView(cd.buffer);
    cv.setUint32(0, 0x02014b50, true);
    cv.setUint16(4, VERSION, true);
    cv.setUint16(6, VERSION, true);
    cv.setUint16(8, UTF8_FLAG, true);
    cv.setUint16(10, method, true);
    cv.setUint16(12, time, true);
    cv.setUint16(14, date, true);
    cv.setUint32(16, crc, true);
    cv.setUint32(20, body.byteLength, true);
    cv.setUint32(24, entry.data.byteLength, true);
    cv.setUint16(28, nameBytes.byteLength, true);
    cv.setUint16(30, 0, true); // extra length
    cv.setUint16(32, 0, true); // comment length
    cv.setUint16(34, 0, true); // disk number
    cv.setUint16(36, 0, true); // internal attributes
    cv.setUint32(38, 0, true); // external attributes
    cv.setUint32(42, offset, true);
    cd.set(nameBytes, 46);

    parts.push(local, body);
    central.push(cd);
    offset += local.byteLength + body.byteLength;
  }

  const cdSize = central.reduce((n, c) => n + c.byteLength, 0);
  const end = new Uint8Array(22);
  const ev = new DataView(end.buffer);
  ev.setUint32(0, 0x06054b50, true);
  ev.setUint16(4, 0, true);
  ev.setUint16(6, 0, true);
  ev.setUint16(8, entries.length, true);
  ev.setUint16(10, entries.length, true);
  ev.setUint32(12, cdSize, true);
  ev.setUint32(16, offset, true);
  ev.setUint16(20, 0, true);

  return concatBytes([...parts, ...central, end]);
}
