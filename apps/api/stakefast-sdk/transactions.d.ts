import type { AccountRole } from '@solana/instructions';

export const STAKEFAST_FEE_RECIPIENT: string;
export const STAKEFAST_ACTION_FEE_LAMPORTS: bigint;
export const STAKEFAST_CREATE_FEE_LAMPORTS: bigint;
export const STAKEFAST_WITHDRAWAL_FEE_BPS: number;
export function withdrawalAmounts(amountRaw: string | bigint): { gross: bigint; fee: bigint; net: bigint };

export type StakeFastPositionInstruction = {
  programAddress: string;
  accounts: { address: string; role: AccountRole }[];
  data: Uint8Array;
};

export function positionInstructions(input: {
  program: string;
  action: 'lock' | 'request_unlock' | 'cancel_unlock' | 'withdraw';
  wallet: string;
  vault: string;
  mint: string;
  tokenProgram: string;
  amountRaw?: string | bigint;
  withdrawalFeeBps?: 0 | 50;
}): StakeFastPositionInstruction[];

export function stakeAmount(amountRaw: string | bigint): bigint;
export function serializePositionTransaction(
  instructions: StakeFastPositionInstruction[], wallet: string,
  lifetime: { blockhash: string; lastValidBlockHeight: number },
): string;
