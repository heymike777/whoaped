import type { AccountRole } from '@solana/instructions';

export const STAKEFAST_FEE_RECIPIENT: string;

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
}): StakeFastPositionInstruction[];

export function stakeAmount(amountRaw: string | bigint): bigint;
export function serializePositionTransaction(
  instructions: StakeFastPositionInstruction[], wallet: string,
  lifetime: { blockhash: string; lastValidBlockHeight: number },
): string;
