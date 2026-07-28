/**
 * Arkade address parsing and validation.
 *
 * Used to reject malformed destination addresses before a swap is created,
 * mirroring the server-side check.
 */

import { ArkAddress } from "@arkade-os/sdk";
import { getNetworkHrp, getNetworkName } from "./arkade-network.js";

/** Bech32m prefixes for Arkade addresses: `ark` (mainnet) and `tark` (test networks). */
const ARKADE_HRPS = ["ark", "tark"];

/**
 * Parses an Arkade address, throwing a descriptive error if it is not a
 * well-formed bech32m Ark address (`ark1...` / `tark1...`).
 *
 * @param address - The Arkade address to parse.
 * @param network - Optional network name (e.g. "bitcoin", "signet",
 *   "mutinynet"). When provided, the address prefix must match the network;
 *   otherwise any known Arkade prefix is accepted.
 * @returns The decoded {@link ArkAddress}.
 * @throws Error if the address is malformed or on the wrong network.
 */
export function parseArkadeAddress(
  address: string,
  network?: string,
): ArkAddress {
  let decoded: ArkAddress;
  try {
    decoded = ArkAddress.decode(address);
  } catch (e) {
    const reason = e instanceof Error ? e.message : String(e);
    throw new Error(`Invalid Arkade address: ${reason}`);
  }

  if (network !== undefined) {
    const expectedHrp = getNetworkHrp(getNetworkName(network));
    if (decoded.hrp !== expectedHrp) {
      throw new Error(
        `Arkade address has wrong network: expected "${expectedHrp}1..." prefix, got "${decoded.hrp}1..."`,
      );
    }
  } else if (!ARKADE_HRPS.includes(decoded.hrp)) {
    throw new Error(`Invalid Arkade address: unknown prefix "${decoded.hrp}1"`);
  }

  return decoded;
}

/**
 * Returns whether the given string is a well-formed Arkade address.
 *
 * @param address - The Arkade address to validate.
 * @param network - Optional network name; when provided the prefix must match.
 */
export function isValidArkadeAddress(
  address: string,
  network?: string,
): boolean {
  try {
    parseArkadeAddress(address, network);
    return true;
  } catch {
    return false;
  }
}
