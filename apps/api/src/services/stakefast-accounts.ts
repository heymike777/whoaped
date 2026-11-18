import { createHash } from 'node:crypto';
import { PublicKey, type AccountInfo } from '@solana/web3.js';
import { decodePosition, decodeVault, positionAddress as derivePositionAddress } from '@stakefast/sdk/accounts';

const VAULT_SEED = Buffer.from('vault');

export function anchorDiscriminator(namespace: 'account' | 'global', name: string) {
  return createHash('sha256').update(`${namespace}:${name}`).digest().subarray(0, 8);
}

export function vaultAddress(program: PublicKey, admin: PublicKey, id: bigint) {
  const idBytes = Buffer.alloc(8);
  idBytes.writeBigUInt64LE(id);
  return PublicKey.findProgramAddressSync([VAULT_SEED, admin.toBuffer(), idBytes], program)[0];
}

export function positionAddress(program: PublicKey, vault: PublicKey, wallet: PublicKey) {
  return new PublicKey(derivePositionAddress(program.toBase58(), vault.toBase58(), wallet.toBase58()));
}

export function decodeStakeFastVault(info: AccountInfo<Buffer> | null, program: PublicKey, address: PublicKey) {
  const { admin, mint, tokenProgram, ...settings } = decodeVault(
    info && { ...info, owner: info.owner.toBase58() }, program.toBase58(), address.toBase58(),
  );
  return {
    ...settings, admin: new PublicKey(admin), mint: new PublicKey(mint), tokenProgram: new PublicKey(tokenProgram),
  };
}

export function decodeStakeFastPosition(info: AccountInfo<Buffer> | null, program: PublicKey, vault: PublicKey, wallet: PublicKey) {
  if (!info) return null;
  const programId = program.toBase58();
  const owner = wallet.toBase58();
  const vaultId = vault.toBase58();
  const { amount, unlockAt } = decodePosition(
    { ...info, owner: info.owner.toBase58() }, programId, owner, derivePositionAddress(programId, vaultId, owner),
  );
  return { amount, unlockAt };
}
