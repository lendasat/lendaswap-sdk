import { describe, expect, it } from "vitest";
import {
  isValidArkadeAddress,
  parseArkadeAddress,
} from "../src/arkade-address.js";

// Test vector from https://github.com/arkade-os/arkd (common/fixtures/encoding.json).
const TESTNET_ADDRESS =
  "tark1qqellv77udfmr20tun8dvju5vgudpf9vxe8jwhthrkn26fz96pawqfdy8nk05rsmrf8h94j26905e7n6sng8y059z8ykn2j5xcuw4xt846qj6x";

describe("parseArkadeAddress", () => {
  it("returns the decoded address for valid input", () => {
    const decoded = parseArkadeAddress(TESTNET_ADDRESS);
    expect(decoded.hrp).toBe("tark");
    expect(decoded.encode()).toBe(TESTNET_ADDRESS);
  });

  it("accepts a valid address with matching network", () => {
    expect(() => parseArkadeAddress(TESTNET_ADDRESS, "signet")).not.toThrow();
    expect(() =>
      parseArkadeAddress(TESTNET_ADDRESS, "mutinynet"),
    ).not.toThrow();
  });

  it("rejects a valid address on the wrong network", () => {
    expect(() => parseArkadeAddress(TESTNET_ADDRESS, "bitcoin")).toThrow(
      /wrong network/,
    );
  });

  it("rejects malformed input", () => {
    expect(() => parseArkadeAddress("")).toThrow(/Invalid Arkade address/);
    expect(() => parseArkadeAddress("not-an-address")).toThrow(
      /Invalid Arkade address/,
    );
    // Valid bech32m but not an Ark payload (a mainnet P2TR address).
    expect(() =>
      parseArkadeAddress(
        "bc1p5d7rjq7g6rdk2yhzks9smlaqtedr4dekq08ge8ztwac72sfr9rusxg3297",
      ),
    ).toThrow(/Invalid Arkade address/);
  });

  it("rejects an address with a corrupted checksum", () => {
    const corrupted = `${TESTNET_ADDRESS.slice(0, -1)}q`;
    expect(() => parseArkadeAddress(corrupted)).toThrow(
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
