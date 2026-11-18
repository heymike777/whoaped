export interface AccountData {
  owner: string;
  executable: boolean;
  data: Uint8Array;
}

export const POSITION_DISCRIMINATOR: string;
export const POSITION_SIZE: number;
export const POSITION_VAULT_OFFSET: number;
export const POSITION_WALLET_OFFSET: number;
export const CLOCK_ADDRESS: string;
export function addressBytes(value: string): Uint8Array;
export function anchorDiscriminator(namespace: 'account' | 'global', name: string): Uint8Array;
export function isOnCurve(bytes: Uint8Array): boolean;
export function findAddress(program: string, ...seeds: Uint8Array[]): string;
export function positionAddress(program: string, vault: string, wallet: string): string;
export function clockUnixTimestamp(account: AccountData | null): bigint;
export function decodeVault(account: AccountData | null, program: string, address: string): {
  admin: string;
  mint: string;
  tokenProgram: string;
  id: bigint;
  cooldownSeconds: bigint;
  depositsPaused: boolean;
};
export function decodePosition(account: AccountData | null, program: string, wallet: string | undefined, address: string): {
  vault: string;
  amount: bigint;
  unlockAt: bigint;
};
