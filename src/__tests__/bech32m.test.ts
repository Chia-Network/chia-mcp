import { describe, it, expect } from "vitest";
import { bech32mEncode, bech32mDecode } from "../bech32m.js";

describe("bech32m", () => {
  const KNOWN_PUZZLE_HASH =
    "0x4843c451e38bf4e25a82e3dfe6f1b22ef0bc30138e638a329c12e32123ec8390";
  const KNOWN_TXCH_ADDRESS =
    "txch1fppug50r306wyk5zu007dudj9mctcvqn3e3c5v5uzt3jzglvswgqsqrmvg";

  describe("bech32mEncode", () => {
    it("encodes known puzzle hash with txch prefix", () => {
      const address = bech32mEncode("txch", KNOWN_PUZZLE_HASH);
      expect(address).toBe(KNOWN_TXCH_ADDRESS);
    });

    it("encodes known puzzle hash with xch prefix", () => {
      const address = bech32mEncode("xch", KNOWN_PUZZLE_HASH);
      expect(address).toMatch(/^xch1/);
      // Decode it back to verify round-trip
      const decoded = bech32mDecode(address);
      expect(decoded.puzzleHash).toBe(KNOWN_PUZZLE_HASH);
      expect(decoded.hrp).toBe("xch");
    });

    it("handles all-zeros puzzle hash", () => {
      const zeros = "0x" + "00".repeat(32);
      const address = bech32mEncode("xch", zeros);
      expect(address).toMatch(/^xch1/);
      const decoded = bech32mDecode(address);
      expect(decoded.puzzleHash).toBe(zeros);
    });

    it("handles puzzle hash without 0x prefix", () => {
      const hex = KNOWN_PUZZLE_HASH.slice(2);
      const address = bech32mEncode("txch", hex);
      expect(address).toBe(KNOWN_TXCH_ADDRESS);
    });
  });

  describe("bech32mDecode", () => {
    it("decodes known txch address", () => {
      const result = bech32mDecode(KNOWN_TXCH_ADDRESS);
      expect(result.hrp).toBe("txch");
      expect(result.puzzleHash).toBe(KNOWN_PUZZLE_HASH);
    });

    it("handles uppercase input (case-insensitive)", () => {
      const result = bech32mDecode(KNOWN_TXCH_ADDRESS.toUpperCase());
      expect(result.puzzleHash).toBe(KNOWN_PUZZLE_HASH);
    });

    it("throws on invalid characters", () => {
      expect(() => bech32mDecode("xch1invalid!address")).toThrow();
    });

    it("throws on bad checksum", () => {
      // Flip a char in the checksum portion
      const bad = KNOWN_TXCH_ADDRESS.slice(0, -1) + "q";
      expect(() => bech32mDecode(bad)).toThrow("Invalid bech32m checksum");
    });

    it("throws on too-short address", () => {
      expect(() => bech32mDecode("xch1a")).toThrow();
    });

    it("throws on address with no separator", () => {
      expect(() => bech32mDecode("noseperator")).toThrow();
    });
  });

  describe("round-trip", () => {
    it("encode then decode returns same puzzle hash", () => {
      const address = bech32mEncode("xch", KNOWN_PUZZLE_HASH);
      const decoded = bech32mDecode(address);
      expect(decoded.puzzleHash).toBe(KNOWN_PUZZLE_HASH);
    });

    it("decode then encode returns same address", () => {
      const decoded = bech32mDecode(KNOWN_TXCH_ADDRESS);
      const reEncoded = bech32mEncode(decoded.hrp, decoded.puzzleHash);
      expect(reEncoded).toBe(KNOWN_TXCH_ADDRESS);
    });

    it("round-trips arbitrary puzzle hashes", () => {
      const hashes = [
        "0x" + "ab".repeat(32),
        "0x" + "ff".repeat(32),
        "0x" + "01".repeat(32),
      ];
      for (const hash of hashes) {
        for (const prefix of ["xch", "txch"]) {
          const addr = bech32mEncode(prefix, hash);
          const dec = bech32mDecode(addr);
          expect(dec.puzzleHash).toBe(hash);
          expect(dec.hrp).toBe(prefix);
        }
      }
    });
  });
});
