/**
 * Bech32m encoding/decoding for Chia addresses.
 * Pure TypeScript implementation — no external dependencies.
 */

const CHARSET = "qpzry9x8gf2tvdw0s3jn54khce6mua7l";
const BECH32M_CONST = 0x2bc830a3;

function polymod(values: number[]): number {
  const GEN = [0x3b6a57b2, 0x26508e6d, 0x1ea119fa, 0x3d4233dd, 0x2a1462b3];
  let chk = 1;
  for (const v of values) {
    const top = chk >> 25;
    chk = ((chk & 0x1ffffff) << 5) ^ v;
    for (let i = 0; i < 5; i++) {
      if ((top >> i) & 1) chk ^= GEN[i];
    }
  }
  return chk;
}

function hrpExpand(hrp: string): number[] {
  const ret: number[] = [];
  for (const c of hrp) ret.push(c.charCodeAt(0) >> 5);
  ret.push(0);
  for (const c of hrp) ret.push(c.charCodeAt(0) & 31);
  return ret;
}

function createChecksum(hrp: string, data: number[]): number[] {
  const values = hrpExpand(hrp).concat(data).concat([0, 0, 0, 0, 0, 0]);
  const mod = polymod(values) ^ BECH32M_CONST;
  const ret: number[] = [];
  for (let p = 0; p < 6; p++) ret.push((mod >> (5 * (5 - p))) & 31);
  return ret;
}

function verifyChecksum(hrp: string, data: number[]): boolean {
  return polymod(hrpExpand(hrp).concat(data)) === BECH32M_CONST;
}

/** Convert between bit groups. */
function convertBits(data: number[], fromBits: number, toBits: number, pad: boolean): number[] {
  let acc = 0;
  let bits = 0;
  const ret: number[] = [];
  const maxv = (1 << toBits) - 1;
  for (const value of data) {
    if (value < 0 || value >> fromBits) throw new Error(`Invalid value: ${value}`);
    acc = (acc << fromBits) | value;
    bits += fromBits;
    while (bits >= toBits) {
      bits -= toBits;
      ret.push((acc >> bits) & maxv);
    }
  }
  if (pad) {
    if (bits > 0) ret.push((acc << (toBits - bits)) & maxv);
  } else if (bits >= fromBits || ((acc << (toBits - bits)) & maxv)) {
    throw new Error("Invalid padding");
  }
  return ret;
}

/**
 * Encode a puzzle hash (0x-prefixed hex) to a bech32m address.
 */
export function bech32mEncode(hrp: string, puzzleHashHex: string): string {
  const hex = puzzleHashHex.startsWith("0x") ? puzzleHashHex.slice(2) : puzzleHashHex;
  const bytes: number[] = [];
  for (let i = 0; i < hex.length; i += 2) {
    bytes.push(parseInt(hex.substring(i, i + 2), 16));
  }
  const data5bit = convertBits(bytes, 8, 5, true);
  const checksum = createChecksum(hrp, data5bit);
  return hrp + "1" + data5bit.concat(checksum).map((d) => CHARSET[d]).join("");
}

/**
 * Decode a bech32m address to { hrp, puzzleHash (0x-prefixed hex) }.
 */
export function bech32mDecode(address: string): { hrp: string; puzzleHash: string } {
  const addr = address.toLowerCase();
  const pos = addr.lastIndexOf("1");
  if (pos < 1 || pos + 7 > addr.length) throw new Error("Invalid bech32m address");
  const hrp = addr.slice(0, pos);
  const dataChars = addr.slice(pos + 1);
  const data: number[] = [];
  for (const c of dataChars) {
    const idx = CHARSET.indexOf(c);
    if (idx === -1) throw new Error(`Invalid character: ${c}`);
    data.push(idx);
  }
  if (!verifyChecksum(hrp, data)) throw new Error("Invalid bech32m checksum");
  const payload = data.slice(0, data.length - 6);
  const bytes = convertBits(payload, 5, 8, false);
  if (bytes.length !== 32) {
    throw new Error(`Invalid puzzle hash length: expected 32 bytes, got ${bytes.length}`);
  }
  const hex = bytes.map((b) => b.toString(16).padStart(2, "0")).join("");
  return { hrp, puzzleHash: "0x" + hex };
}

/**
 * Decode a bech32m string of arbitrary length to raw bytes.
 * Unlike bech32mDecode, this does NOT enforce a 32-byte output.
 * Returns { hrp, data: Buffer }.
 */
export function bech32mDecodeRaw(input: string): { hrp: string; data: Buffer } {
  const str = input.toLowerCase();
  const pos = str.lastIndexOf("1");
  if (pos < 1 || pos + 7 > str.length) throw new Error("Invalid bech32m string");
  const hrp = str.slice(0, pos);
  const dataChars = str.slice(pos + 1);
  const data: number[] = [];
  for (const c of dataChars) {
    const idx = CHARSET.indexOf(c);
    if (idx === -1) throw new Error(`Invalid character: ${c}`);
    data.push(idx);
  }
  if (!verifyChecksum(hrp, data)) throw new Error("Invalid bech32m checksum");
  const payload = data.slice(0, data.length - 6);
  const bytes = convertBits(payload, 5, 8, false);
  return { hrp, data: Buffer.from(bytes) };
}
