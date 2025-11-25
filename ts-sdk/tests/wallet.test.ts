import { describe, it, expect, beforeEach } from "vitest";
import { Wallet } from "../src/wallet.js";
import { MemoryStorageProvider } from "../src/storage/memory.js";

describe("Wallet", () => {
  let storage: MemoryStorageProvider;

  beforeEach(() => {
    storage = new MemoryStorageProvider();
  });

  it("should create a wallet instance", async () => {
    const wallet = await Wallet.create(storage, "bitcoin");
    expect(wallet).toBeDefined();
    expect(wallet.getNetwork()).toBe("bitcoin");
  });

  it("should generate a mnemonic", async () => {
    const wallet = await Wallet.create(storage, "bitcoin");
    const mnemonic = await wallet.generateOrGetMnemonic();

    expect(mnemonic).toBeDefined();
    expect(typeof mnemonic).toBe("string");

    // Should be 12 words
    const words = mnemonic.split(" ");
    expect(words.length).toBe(12);
  });

  it("should return the same mnemonic on subsequent calls", async () => {
    const wallet = await Wallet.create(storage, "bitcoin");

    const mnemonic1 = await wallet.generateOrGetMnemonic();
    const mnemonic2 = await wallet.generateOrGetMnemonic();

    expect(mnemonic1).toBe(mnemonic2);
  });

  it("should persist mnemonic across wallet instances", async () => {
    const wallet1 = await Wallet.create(storage, "bitcoin");
    const mnemonic1 = await wallet1.generateOrGetMnemonic();

    // Create new wallet with same storage
    const wallet2 = await Wallet.create(storage, "bitcoin");
    const mnemonic2 = await wallet2.generateOrGetMnemonic();

    expect(mnemonic1).toBe(mnemonic2);
  });

  it("should import a mnemonic", async () => {
    const wallet = await Wallet.create(storage, "bitcoin");
    const testMnemonic =
      "abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon about";

    await wallet.importMnemonic(testMnemonic);
    const storedMnemonic = await wallet.getMnemonic();

    expect(storedMnemonic).toBe(testMnemonic);
  });

  it("should derive swap params", async () => {
    const wallet = await Wallet.create(storage, "bitcoin");
    await wallet.generateOrGetMnemonic();

    const params = await wallet.deriveSwapParams();

    expect(params).toBeDefined();
    expect(params.keyIndex).toBe(0);
    expect(params.ownSk).toBeDefined();
    expect(params.ownPk).toBeDefined();
    expect(params.preimage).toBeDefined();
    expect(params.preimageHash).toBeDefined();
    expect(params.userId).toBeDefined();

    // All values should be hex strings
    expect(params.ownSk.length).toBeGreaterThan(0);
    expect(params.ownPk.length).toBeGreaterThan(0);
    expect(params.preimage.length).toBe(64); // 32 bytes hex
    expect(params.preimageHash.length).toBe(64); // 32 bytes hex
  });

  it("should increment key index on each derivation", async () => {
    const wallet = await Wallet.create(storage, "bitcoin");
    await wallet.generateOrGetMnemonic();

    const params1 = await wallet.deriveSwapParams();
    const params2 = await wallet.deriveSwapParams();
    const params3 = await wallet.deriveSwapParams();

    expect(params1.keyIndex).toBe(0);
    expect(params2.keyIndex).toBe(1);
    expect(params3.keyIndex).toBe(2);

    // Different keys for different indices
    expect(params1.ownSk).not.toBe(params2.ownSk);
    expect(params2.ownSk).not.toBe(params3.ownSk);
  });

  it("should derive same params at same index", async () => {
    const wallet = await Wallet.create(storage, "bitcoin");
    await wallet.generateOrGetMnemonic();

    const params1 = await wallet.deriveSwapParamsAtIndex(5);
    const params2 = await wallet.deriveSwapParamsAtIndex(5);

    expect(params1.ownSk).toBe(params2.ownSk);
    expect(params1.preimage).toBe(params2.preimage);
    expect(params1.keyIndex).toBe(5);
    expect(params2.keyIndex).toBe(5);
  });

  it("should get user ID xpub", async () => {
    const wallet = await Wallet.create(storage, "bitcoin");
    await wallet.generateOrGetMnemonic();

    const xpub = await wallet.getUserIdXpub();

    expect(xpub).toBeDefined();
    expect(typeof xpub).toBe("string");
    expect(xpub!.startsWith("xpub")).toBe(true);
  });

  it("should return null xpub when no mnemonic", async () => {
    const wallet = await Wallet.create(storage, "bitcoin");

    const xpub = await wallet.getUserIdXpub();

    expect(xpub).toBeNull();
  });

  it("should work with testnet network", async () => {
    const wallet = await Wallet.create(storage, "testnet");
    expect(wallet.getNetwork()).toBe("testnet");

    const mnemonic = await wallet.generateOrGetMnemonic();
    expect(mnemonic.split(" ").length).toBe(12);
  });

  it("should produce deterministic keys from same mnemonic", async () => {
    const testMnemonic =
      "abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon about";

    // Create two wallets with same mnemonic
    const storage1 = new MemoryStorageProvider();
    const storage2 = new MemoryStorageProvider();

    const wallet1 = await Wallet.create(storage1, "bitcoin");
    const wallet2 = await Wallet.create(storage2, "bitcoin");

    await wallet1.importMnemonic(testMnemonic);
    await wallet2.importMnemonic(testMnemonic);

    const params1 = await wallet1.deriveSwapParamsAtIndex(0);
    const params2 = await wallet2.deriveSwapParamsAtIndex(0);

    expect(params1.ownSk).toBe(params2.ownSk);
    expect(params1.ownPk).toBe(params2.ownPk);
    expect(params1.preimage).toBe(params2.preimage);
    expect(params1.preimageHash).toBe(params2.preimageHash);
    expect(params1.userId).toBe(params2.userId);
  });
});
