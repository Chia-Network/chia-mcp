import { describe, it, expect } from "vitest";
import { createHash } from "crypto";
import { computeCoinId, amountToBytes } from "../tools.js";

describe("coin ID computation", () => {
  describe("amount encoding", () => {
    it("amount 0 → empty bytes", () => {
      expect(amountToBytes(0n).length).toBe(0);
    });

    it("amount 1 → single byte 0x01", () => {
      const b = amountToBytes(1n);
      expect(b.length).toBe(1);
      expect(b[0]).toBe(0x01);
    });

    it("amount 127 → single byte 0x7f", () => {
      const b = amountToBytes(127n);
      expect(b.length).toBe(1);
      expect(b[0]).toBe(0x7f);
    });

    it("amount 128 → two bytes 0x0080 (high bit set needs leading zero)", () => {
      const b = amountToBytes(128n);
      expect(b.length).toBe(2);
      expect(b[0]).toBe(0x00);
      expect(b[1]).toBe(0x80);
    });

    it("amount 255 → two bytes 0x00ff", () => {
      const b = amountToBytes(255n);
      expect(b.length).toBe(2);
      expect(b[0]).toBe(0x00);
      expect(b[1]).toBe(0xff);
    });

    it("amount 256 → two bytes 0x0100", () => {
      const b = amountToBytes(256n);
      expect(b.length).toBe(2);
      expect(b[0]).toBe(0x01);
      expect(b[1]).toBe(0x00);
    });

    it("amount 21000000000000 (21T mojos)", () => {
      const b = amountToBytes(21000000000000n);
      expect(b.toString("hex")).toBe("1319718a5000");
    });
  });

  describe("SHA256 coin ID", () => {
    it("computes genesis challenge coin ID correctly", () => {
      const parent =
        "0x0000000000000000000000000000000000000000000000000000000000000000";
      const puzzleHash =
        "0x0eb39e2a265e4b2ee8e76413c29e7fb64fd63a51f44d2e7e3b12f01589e47a5d";
      const amount = 21000000000000n;

      const coinId = computeCoinId(parent, puzzleHash, amount);

      const expected = createHash("sha256")
        .update(Buffer.alloc(32, 0))
        .update(Buffer.from(puzzleHash.slice(2), "hex"))
        .update(Buffer.from("1319718a5000", "hex"))
        .digest("hex");

      expect(coinId).toBe("0x" + expected);
    });

    it("computes coin ID with amount = 0", () => {
      const parent = "0x" + "aa".repeat(32);
      const puzzle = "0x" + "bb".repeat(32);
      const coinId = computeCoinId(parent, puzzle, 0n);

      const expected = createHash("sha256")
        .update(Buffer.from("aa".repeat(32), "hex"))
        .update(Buffer.from("bb".repeat(32), "hex"))
        .digest("hex");

      expect(coinId).toBe("0x" + expected);
    });

    it("computes coin ID with amount = 1", () => {
      const parent = "0x" + "00".repeat(32);
      const puzzle = "0x" + "00".repeat(32);
      const coinId = computeCoinId(parent, puzzle, 1n);

      const expected = createHash("sha256")
        .update(Buffer.alloc(32, 0))
        .update(Buffer.alloc(32, 0))
        .update(Buffer.from([0x01]))
        .digest("hex");

      expect(coinId).toBe("0x" + expected);
    });

    it("different amounts produce different coin IDs", () => {
      const parent = "0x" + "00".repeat(32);
      const puzzle = "0x" + "00".repeat(32);
      const id0 = computeCoinId(parent, puzzle, 0n);
      const id1 = computeCoinId(parent, puzzle, 1n);
      const id128 = computeCoinId(parent, puzzle, 128n);
      expect(id0).not.toBe(id1);
      expect(id1).not.toBe(id128);
      expect(id0).not.toBe(id128);
    });

    it("known literal vector — testnet11 block-1 farming reward coin ID", () => {
      // Independently verified against chia-blockchain Python:
      //   from chia.types.blockchain_format.coin import Coin
      //   from chia.types.blockchain_format.sized_bytes import bytes32
      //   from chia.util.ints import uint64
      //   c = Coin(
      //     bytes32.from_hexstr("37a90eb5185a9c4439a91ddc98bbadce00000000000000000000000000000000"),
      //     bytes32.from_hexstr("3ef7c233fc0785f3c0cae5992c1d35e7c955ca37a423571c1607ba392a9d12f7"),
      //     uint64(18375000000000000000)
      //   )
      //   assert str(c.name()) == "0x85ebd56f9a9844276433ff85e09518572084eb0b75da04c77fe2537eb02551f3"
      const coinId = computeCoinId(
        "0x37a90eb5185a9c4439a91ddc98bbadce00000000000000000000000000000000",
        "0x3ef7c233fc0785f3c0cae5992c1d35e7c955ca37a423571c1607ba392a9d12f7",
        18375000000000000000n
      );
      expect(coinId).toBe("0x85ebd56f9a9844276433ff85e09518572084eb0b75da04c77fe2537eb02551f3");
    });
  });
});
