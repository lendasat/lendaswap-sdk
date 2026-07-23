import { describe, expect, it } from "vitest";
import {
  isValidArkadeAddress,
  validateArkadeAddress,
} from "../src/arkade-address.js";

// Test vector from https://github.com/arkade-os/arkd (common/fixtures/encoding.json).
const TESTNET_ADDRESS =
  "tark1qqellv77udfmr20tun8dvju5vgudpf9vxe8jwhthrkn26fz96pawqfdy8nk05rsmrf8h94j26905e7n6sng8y059z8ykn2j5xcuw4xt846qj6x";

describe("validateArkadeAddress", () => {
  it("accepts a valid address", () => {
    expect(() => validateArkadeAddress(TESTNET_ADDRESS)).not.toThrow();
  });

  it("accepts a valid address with matching network", () => {
    expect(() =>
      validateArkadeAddress(TESTNET_ADDRESS, "signet"),
    ).not.toThrow();
    expect(() =>
      validateArkadeAddress(TESTNET_ADDRESS, "mutinynet"),
    ).not.toThrow();
  });

  it("rejects a valid address on the wrong network", () => {
    expect(() => validateArkadeAddress(TESTNET_ADDRESS, "bitcoin")).toThrow(
      /wrong network/,
    );
  });

  it("rejects malformed input", () => {
    expect(() => validateArkadeAddress("")).toThrow(/Invalid Arkade address/);
    expect(() => validateArkadeAddress("not-an-address")).toThrow(
      /Invalid Arkade address/,
    );
    // Valid bech32m but not an Ark payload (a mainnet P2TR address).
    expect(() =>
      validateArkadeAddress(
        "bc1p5d7rjq7g6rdk2yhzks9smlaqtedr4dekq08ge8ztwac72sfr9rusxg3297",
      ),
    ).toThrow(/Invalid Arkade address/);
  });

  it("rejects an address with a corrupted checksum", () => {
    const corrupted = `${TESTNET_ADDRESS.slice(0, -1)}q`;
    expect(() => validateArkadeAddress(corrupted)).toThrow(
      /Invalid Arkade address/,
    );
  });
});

describe("isValidArkadeAddress", () => {
  it("returns true for a valid address and false otherwise", () => {
    expect(isValidArkadeAddress(TESTNET_ADDRESS)).toBe(true);
    expect(isValidArkadeAddress(TESTNET_ADDRESS, "signet")).toBe(true);
    expect(isValidArkadeAddress(TESTNET_ADDRESS, "bitcoin")).toBe(false);
    expect(isValidArkadeAddress("tark1invalid")).toBe(false);
    expect(isValidArkadeAddress("")).toBe(false);
  });
});
