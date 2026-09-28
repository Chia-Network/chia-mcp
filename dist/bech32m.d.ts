/**
 * Bech32m encoding/decoding for Chia addresses.
 * Pure TypeScript implementation — no external dependencies.
 */
/**
 * Encode a puzzle hash (0x-prefixed hex) to a bech32m address.
 */
export declare function bech32mEncode(hrp: string, puzzleHashHex: string): string;
/**
 * Decode a bech32m address to { hrp, puzzleHash (0x-prefixed hex) }.
 */
export declare function bech32mDecode(address: string): {
    hrp: string;
    puzzleHash: string;
};
/**
 * Decode a bech32m string of arbitrary length to raw bytes.
 * Unlike bech32mDecode, this does NOT enforce a 32-byte output.
 * Returns { hrp, data: Buffer }.
 */
export declare function bech32mDecodeRaw(input: string): {
    hrp: string;
    data: Buffer;
};
//# sourceMappingURL=bech32m.d.ts.map