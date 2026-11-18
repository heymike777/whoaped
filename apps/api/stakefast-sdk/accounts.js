import { ed25519 } from '@noble/curves/ed25519.js';
import { sha256 } from '@noble/hashes/sha2.js';
import { concatBytes } from '@noble/hashes/utils.js';
import { base58 } from '@scure/base';

const ascii = text => Uint8Array.from(text, character => character.charCodeAt(0));
const pdaMarker = ascii('ProgramDerivedAddress');
const vaultSeed = ascii('vault');
const positionSeed = ascii('position');
export const anchorDiscriminator = (namespace, name) => sha256(ascii(`${namespace}:${name}`)).subarray(0, 8);
const vaultDiscriminator = anchorDiscriminator('account', 'Vault');
const positionDiscriminator = anchorDiscriminator('account', 'Position');
export const POSITION_DISCRIMINATOR = base58.encode(positionDiscriminator);
export const POSITION_SIZE = 88;
export const POSITION_VAULT_OFFSET = 8;
export const POSITION_WALLET_OFFSET = 40;
const equal = (left, right) => left.length === right.length && left.every((byte, i) => byte === right[i]);

export function addressBytes(value) {
  if (typeof value !== 'string' || value.length < 32 || value.length > 44) throw new Error('Invalid Solana address.');
  const bytes = base58.decode(value);
  if (bytes.length !== 32) throw new Error('Invalid Solana address.');
  return bytes;
}

export function isOnCurve(bytes) {
  try {
    // Solana rejects any candidate the Ed25519 point decompressor accepts.
    ed25519.Point.fromBytes(bytes, true);
    return true;
  } catch {
    return false;
  }
}

export function findAddress(program, ...seeds) {
  const programBytes = addressBytes(program);
  for (let bump = 255; bump >= 0; bump--) {
    const hash = sha256(concatBytes(...seeds, Uint8Array.of(bump), programBytes, pdaMarker));
    if (!isOnCurve(hash)) return base58.encode(hash);
  }
  throw new Error('Could not derive a StakeFast account address.');
}

function readU64(view, offset) {
  return (BigInt(view.getUint32(offset + 4, true)) << 32n) | BigInt(view.getUint32(offset, true));
}

export function positionAddress(program, vault, wallet) {
  return findAddress(program, positionSeed, addressBytes(vault), addressBytes(wallet));
}

export const CLOCK_ADDRESS = 'SysvarC1ock11111111111111111111111111111111';
export function clockUnixTimestamp(account) {
  if (account?.owner !== 'Sysvar1111111111111111111111111111111111111' || account.executable || account.data.length !== 40) {
    throw new Error('Invalid Solana clock account.');
  }
  const { data } = account;
  const view = new DataView(data.buffer, data.byteOffset, data.byteLength);
  return BigInt.asIntN(64, readU64(view, 32));
}

export function decodeVault(account, program, address) {
  const data = account?.data;
  if (!account || account.owner !== program || account.executable || data.length !== 130 ||
    !equal(data.subarray(0, 8), vaultDiscriminator) || data[128] > 1) {
    throw new Error('Invalid StakeFast vault account.');
  }
  const view = new DataView(data.buffer, data.byteOffset, data.byteLength);
  const adminBytes = data.subarray(8, 40);
  const idBytes = data.subarray(104, 112);
  // Bytes 112–119 are reserved in current and legacy accounts.
  const cooldownSeconds = BigInt.asIntN(64, readU64(view, 120));
  if (cooldownSeconds < 0n || findAddress(program, vaultSeed, adminBytes, idBytes) !== address) {
    throw new Error('Invalid StakeFast vault settings.');
  }
  return {
    admin: base58.encode(adminBytes),
    mint: base58.encode(data.subarray(40, 72)),
    tokenProgram: base58.encode(data.subarray(72, 104)),
    id: readU64(view, 104),
    cooldownSeconds,
    depositsPaused: data[128] === 1,
  };
}

export function decodePosition(account, program, wallet, address) {
  const data = account?.data;
  if (!account || account.owner !== program || account.executable || data.length !== POSITION_SIZE ||
    !equal(data.subarray(0, POSITION_VAULT_OFFSET), positionDiscriminator)) {
    throw new Error('Invalid StakeFast position account.');
  }
  const vault = base58.encode(data.subarray(POSITION_VAULT_OFFSET, POSITION_WALLET_OFFSET));
  const owner = base58.encode(data.subarray(POSITION_WALLET_OFFSET, 72));
  if (wallet !== undefined && owner !== wallet) throw new Error('Invalid StakeFast position account.');
  const view = new DataView(data.buffer, data.byteOffset, data.byteLength);
  const amount = readU64(view, 72);
  const unlockAt = BigInt.asIntN(64, readU64(view, 80));
  if (amount === 0n || unlockAt < 0n || positionAddress(program, vault, owner) !== address) {
    throw new Error('Invalid StakeFast position state.');
  }
  return { vault, amount, unlockAt };
}
