import { secp256k1 } from "@noble/curves/secp256k1.js";
import { hex } from "@scure/base";
import { describe, expect, it } from "vitest";
import {
  buildOnchainRefundTransaction,
  computeHash160,
  verifyHtlcAddress,
} from "../src/refund/onchain.js";

describe("On-chain refund", () => {
  // Test keypairs (deterministic for testing)
  const serverSecretKey = new Uint8Array(32).fill(1);
  const userSecretKey = new Uint8Array(32).fill(2);

  // Get x-only public keys (32 bytes, no prefix)
  // secp256k1.getPublicKey returns compressed (33 bytes), slice to get x-only
  const serverPubKey = hex.encode(
    secp256k1.getPublicKey(serverSecretKey, true).slice(1),
  );
  const userPubKey = hex.encode(
    secp256k1.getPublicKey(userSecretKey, true).slice(1),
  );
  const userSecretKeyHex = hex.encode(userSecretKey);

  // Test secret and hash lock
  const secret = new Uint8Array(32).fill(42);
  const hashLock = hex.encode(computeHash160(secret));

  // Test parameters
  const refundLocktime = 1700000000; // Unix timestamp in the past
  const fundingTxId = "0".repeat(64); // Dummy txid
  const htlcAmount = 100000n; // 100k sats

  describe("computeHash160", () => {
    it("should compute RIPEMD160(SHA256(data))", () => {
      const data = new Uint8Array(32).fill(42);
      const hash = computeHash160(data);

      expect(hash).toBeInstanceOf(Uint8Array);
      expect(hash.length).toBe(20);

      // Hash should be deterministic
      const hash2 = computeHash160(data);
      expect(hex.encode(hash)).toBe(hex.encode(hash2));
    });

    it("should produce different hashes for different inputs", () => {
      const data1 = new Uint8Array(32).fill(1);
      const data2 = new Uint8Array(32).fill(2);

      const hash1 = computeHash160(data1);
      const hash2 = computeHash160(data2);

      expect(hex.encode(hash1)).not.toBe(hex.encode(hash2));
    });
  });

  describe("verifyHtlcAddress", () => {
    it("should return true for matching HTLC parameters", () => {
      // Verify the HTLC address matches
      const isValid = verifyHtlcAddress(
        "tb1pmflkz8yplmk3v8htfmda2dqcnxgkj6fldrzslq90qc3y3h235spq6juwps",
        "9befb12985069ca625bce37f13af8acbb66e46bb",
        "6c932b95705b07c4236a1abfabe283399774449914f6c4d7faeb30fd7f3c6b0e",
        "d149150a0c344bae35cfe0cd237e50bd41ec56fe7c2a2f5f8509911ec8c5a0e2",
        1769752815,
        "signet",
      );

      expect(isValid).toBe(true);
    });

    it("should return true for matching HTLC parameters", () => {
      // Build a transaction to get the HTLC address
      const result = buildOnchainRefundTransaction({
        fundingTxId,
        fundingVout: 0,
        htlcAmount,
        hashLock,
        serverPubKey,
        userPubKey,
        userSecretKey: userSecretKeyHex,
        refundLocktime,
        destinationAddress: "bcrt1qw508d6qejxtdg4y5r3zarvary0c5xw7kygt080",
        feeRateSatPerVb: 1,
        network: "regtest",
      });

      // Verify the HTLC address matches
      const isValid = verifyHtlcAddress(
        result.htlcAddress,
        hashLock,
        serverPubKey,
        userPubKey,
        refundLocktime,
        "regtest",
      );

      expect(result.htlcAddress).toBe(
        "bcrt1pals5upc3vwh8f55tvtrvvhx4pqfxzqx83esy0caftd3rh7ap8ruqv4l9af",
      );

      expect(isValid).toBe(true);
    });

    it("should return false for wrong hash lock", () => {
      const result = buildOnchainRefundTransaction({
        fundingTxId,
        fundingVout: 0,
        htlcAmount,
        hashLock,
        serverPubKey,
        userPubKey,
        userSecretKey: userSecretKeyHex,
        refundLocktime,
        destinationAddress: "tb1qw508d6qejxtdg4y5r3zarvary0c5xw7kxpjzsx",
        feeRateSatPerVb: 1,
        network: "testnet",
      });

      // Use a different hash lock
      const wrongHashLock = hex.encode(
        computeHash160(new Uint8Array(32).fill(99)),
      );

      const isValid = verifyHtlcAddress(
        result.htlcAddress,
        wrongHashLock,
        serverPubKey,
        userPubKey,
        refundLocktime,
        "testnet",
      );

      expect(isValid).toBe(false);
    });

    it("should return false for wrong server pubkey", () => {
      const result = buildOnchainRefundTransaction({
        fundingTxId,
        fundingVout: 0,
        htlcAmount,
        hashLock,
        serverPubKey,
        userPubKey,
        userSecretKey: userSecretKeyHex,
        refundLocktime,
        destinationAddress: "tb1qw508d6qejxtdg4y5r3zarvary0c5xw7kxpjzsx",
        feeRateSatPerVb: 1,
        network: "testnet",
      });

      // Use a different server pubkey
      const wrongServerPubKey = hex.encode(
        secp256k1.getPublicKey(new Uint8Array(32).fill(99), true).slice(1),
      );

      const isValid = verifyHtlcAddress(
        result.htlcAddress,
        hashLock,
        wrongServerPubKey,
        userPubKey,
        refundLocktime,
        "testnet",
      );

      expect(isValid).toBe(false);
    });

    it("should return false for wrong refund locktime", () => {
      const result = buildOnchainRefundTransaction({
        fundingTxId,
        fundingVout: 0,
        htlcAmount,
        hashLock,
        serverPubKey,
        userPubKey,
        userSecretKey: userSecretKeyHex,
        refundLocktime,
        destinationAddress: "tb1qw508d6qejxtdg4y5r3zarvary0c5xw7kxpjzsx",
        feeRateSatPerVb: 1,
        network: "testnet",
      });

      const isValid = verifyHtlcAddress(
        result.htlcAddress,
        hashLock,
        serverPubKey,
        userPubKey,
        refundLocktime + 1, // Wrong locktime
        "testnet",
      );

      expect(isValid).toBe(false);
    });

    it("should work across different networks", () => {
      // Build for mainnet
      const mainnetResult = buildOnchainRefundTransaction({
        fundingTxId,
        fundingVout: 0,
        htlcAmount,
        hashLock,
        serverPubKey,
        userPubKey,
        userSecretKey: userSecretKeyHex,
        refundLocktime,
        destinationAddress: "bc1qw508d6qejxtdg4y5r3zarvary0c5xw7kv8f3t4",
        feeRateSatPerVb: 1,
        network: "mainnet",
      });

      // Verify with correct network
      expect(
        verifyHtlcAddress(
          mainnetResult.htlcAddress,
          hashLock,
          serverPubKey,
          userPubKey,
          refundLocktime,
          "mainnet",
        ),
      ).toBe(true);

      // Verify with wrong network should fail (different address encoding)
      expect(
        verifyHtlcAddress(
          mainnetResult.htlcAddress,
          hashLock,
          serverPubKey,
          userPubKey,
          refundLocktime,
          "testnet",
        ),
      ).toBe(false);
    });
  });

  // describe("buildOnchainRefundTransaction", () => {
  //   it("should build a valid refund transaction", () => {
  //     const result = buildOnchainRefundTransaction({
  //       fundingTxId,
  //       fundingVout: 0,
  //       htlcAmount,
  //       hashLock,
  //       serverPubKey,
  //       userPubKey,
  //       userSecretKey: userSecretKeyHex,
  //       refundLocktime,
  //       destinationAddress: "tb1qw508d6qejxtdg4y5r3zarvary0c5xw7kxpjzsx",
  //       feeRateSatPerVb: 1,
  //       network: "testnet",
  //     });
  //
  //     expect(result.txHex).toBeDefined();
  //     expect(result.txHex.length).toBeGreaterThan(0);
  //     expect(result.txId).toBeDefined();
  //     expect(result.txId.length).toBe(64);
  //     expect(result.refundAmount).toBeDefined();
  //     expect(result.fee).toBeDefined();
  //   });
  //
  //   it("should deduct fee from refund amount", () => {
  //     const feeRate = 5;
  //     const result = buildOnchainRefundTransaction({
  //       fundingTxId,
  //       fundingVout: 0,
  //       htlcAmount,
  //       hashLock,
  //       serverPubKey,
  //       userPubKey,
  //       userSecretKey: userSecretKeyHex,
  //       refundLocktime,
  //       destinationAddress: "tb1qw508d6qejxtdg4y5r3zarvary0c5xw7kxpjzsx",
  //       feeRateSatPerVb: feeRate,
  //       network: "testnet",
  //     });
  //
  //     expect(result.refundAmount + result.fee).toBe(htlcAmount);
  //     expect(result.fee).toBeGreaterThan(0n);
  //   });
  //
  //   it("should throw if fee exceeds HTLC amount", () => {
  //     const smallAmount = 100n; // Very small amount
  //     const highFeeRate = 10; // Will exceed amount
  //
  //     expect(() =>
  //       buildOnchainRefundTransaction({
  //         fundingTxId,
  //         fundingVout: 0,
  //         htlcAmount: smallAmount,
  //         hashLock,
  //         serverPubKey,
  //         userPubKey,
  //         userSecretKey: userSecretKeyHex,
  //         refundLocktime,
  //         destinationAddress: "tb1qw508d6qejxtdg4y5r3zarvary0c5xw7kxpjzsx",
  //         feeRateSatPerVb: highFeeRate,
  //         network: "testnet",
  //       }),
  //     ).toThrow("exceeds HTLC amount");
  //   });
  //
  //   it("should throw for invalid hash lock length", () => {
  //     expect(() =>
  //       buildOnchainRefundTransaction({
  //         fundingTxId,
  //         fundingVout: 0,
  //         htlcAmount,
  //         hashLock: "abcd", // Too short
  //         serverPubKey,
  //         userPubKey,
  //         userSecretKey: userSecretKeyHex,
  //         refundLocktime,
  //         destinationAddress: "tb1qw508d6qejxtdg4y5r3zarvary0c5xw7kxpjzsx",
  //         feeRateSatPerVb: 1,
  //         network: "testnet",
  //       }),
  //     ).toThrow("Invalid hash lock length");
  //   });
  //
  //   it("should throw for invalid server pubkey length", () => {
  //     expect(() =>
  //       buildOnchainRefundTransaction({
  //         fundingTxId,
  //         fundingVout: 0,
  //         htlcAmount,
  //         hashLock,
  //         serverPubKey: "abcd", // Too short
  //         userPubKey,
  //         userSecretKey: userSecretKeyHex,
  //         refundLocktime,
  //         destinationAddress: "tb1qw508d6qejxtdg4y5r3zarvary0c5xw7kxpjzsx",
  //         feeRateSatPerVb: 1,
  //         network: "testnet",
  //       }),
  //     ).toThrow("Invalid server pubkey length");
  //   });
  //
  //   it("should work for different networks", () => {
  //     // Mainnet
  //     const mainnetResult = buildOnchainRefundTransaction({
  //       fundingTxId,
  //       fundingVout: 0,
  //       htlcAmount,
  //       hashLock,
  //       serverPubKey,
  //       userPubKey,
  //       userSecretKey: userSecretKeyHex,
  //       refundLocktime,
  //       destinationAddress: "bc1qw508d6qejxtdg4y5r3zarvary0c5xw7kv8f3t4",
  //       feeRateSatPerVb: 1,
  //       network: "mainnet",
  //     });
  //     expect(mainnetResult.txHex).toBeDefined();
  //
  //     // Signet (uses testnet addresses)
  //     const signetResult = buildOnchainRefundTransaction({
  //       fundingTxId,
  //       fundingVout: 0,
  //       htlcAmount,
  //       hashLock,
  //       serverPubKey,
  //       userPubKey,
  //       userSecretKey: userSecretKeyHex,
  //       refundLocktime,
  //       destinationAddress: "tb1qw508d6qejxtdg4y5r3zarvary0c5xw7kxpjzsx",
  //       feeRateSatPerVb: 1,
  //       network: "signet",
  //     });
  //     expect(signetResult.txHex).toBeDefined();
  //   });
  // });
});
