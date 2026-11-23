import { AccountRole } from '@solana/instructions';
import {
  appendTransactionMessageInstructions, createTransactionMessage, setTransactionMessageFeePayer,
  setTransactionMessageLifetimeUsingBlockhash,
} from '@solana/transaction-messages';
import { compileTransaction, getBase64EncodedWireTransaction } from '@solana/transactions';
import { addressBytes, anchorDiscriminator, findAddress, positionAddress } from './accounts.js';

const SYSTEM_PROGRAM = '11111111111111111111111111111111';
const ASSOCIATED_TOKEN_PROGRAM = 'ATokenGPvbdGVxr1b2hvZbsiqW5xWH25efTNsLJA8knL';
export const STAKEFAST_FEE_RECIPIENT = '5VW1Ry8okrK4XLUZnmtqCiXKLHLV7XBYg3Mu9qwycpgH';
export const STAKEFAST_ACTION_FEE_LAMPORTS = 2_000_000n;
export const STAKEFAST_CREATE_FEE_LAMPORTS = 100_000_000n;
export const STAKEFAST_WITHDRAWAL_FEE_BPS = 50;
const MAX_AMOUNT = (1n << 64n) - 1n;
const account = (address, role = AccountRole.READONLY) => ({ address, role });

function associatedTokenAddress(owner, mint, tokenProgram) {
  return findAddress(ASSOCIATED_TOKEN_PROGRAM, addressBytes(owner), addressBytes(tokenProgram), addressBytes(mint));
}

export function stakeAmount(amountRaw) {
  if (typeof amountRaw === 'string' && /^[0-9]{1,20}$/.test(amountRaw)) amountRaw = BigInt(amountRaw);
  if (typeof amountRaw !== 'bigint' || amountRaw < 1n || amountRaw > MAX_AMOUNT) {
    throw new Error('Stake amount must be a positive u64 in token base units.');
  }
  return amountRaw;
}

export function withdrawalAmounts(amountRaw) {
  const gross = stakeAmount(amountRaw);
  const fee = gross / 200n;
  return { gross, fee, net: gross - fee };
}

export function positionInstructions({ program, action, wallet, vault, mint, tokenProgram, amountRaw, withdrawalFeeBps = STAKEFAST_WITHDRAWAL_FEE_BPS }) {
  const position = positionAddress(program, vault, wallet);
  const discriminator = anchorDiscriminator('global', action);
  const vaultAccount = account(vault);
  const positionAccount = account(position, AccountRole.WRITABLE);
  const payer = account(wallet, AccountRole.WRITABLE_SIGNER);
  const systemProgramAccount = account(SYSTEM_PROGRAM);
  const feeAccounts = [systemProgramAccount, account(STAKEFAST_FEE_RECIPIENT, AccountRole.WRITABLE)];
  if (action === 'request_unlock' || action === 'cancel_unlock') {
    return [{ programAddress: program, accounts: [payer, vaultAccount, positionAccount, ...feeAccounts], data: discriminator }];
  }
  if (action !== 'lock' && action !== 'withdraw') throw new Error('Unknown StakeFast position action.');
  const ownerTokens = associatedTokenAddress(wallet, mint, tokenProgram);
  const vaultTokens = associatedTokenAddress(vault, mint, tokenProgram);
  const ownerTokenAccount = account(ownerTokens, AccountRole.WRITABLE);
  const mintAccount = account(mint);
  const tokenProgramAccount = account(tokenProgram);
  const accounts = [payer, vaultAccount, positionAccount, mintAccount, ownerTokenAccount,
    account(vaultTokens, AccountRole.WRITABLE), tokenProgramAccount, ...feeAccounts];
  if (action === 'lock') {
    const amount = stakeAmount(amountRaw);
    const data = new Uint8Array(16);
    data.set(discriminator);
    const view = new DataView(data.buffer);
    view.setUint32(8, Number(amount & 0xffff_ffffn), true);
    view.setUint32(12, Number(amount >> 32n), true);
    return [{ programAddress: program, accounts, data }];
  }
  accounts.push(account(associatedTokenAddress(STAKEFAST_FEE_RECIPIENT, mint, tokenProgram), AccountRole.WRITABLE), account(ASSOCIATED_TOKEN_PROGRAM));
  if (withdrawalFeeBps !== 0 && withdrawalFeeBps !== STAKEFAST_WITHDRAWAL_FEE_BPS) throw new Error('Unsupported withdrawal fee.');
  const withdrawData = new Uint8Array(10);
  withdrawData.set(discriminator);
  new DataView(withdrawData.buffer).setUint16(8, withdrawalFeeBps, true);
  return [
    {
      programAddress: ASSOCIATED_TOKEN_PROGRAM,
      accounts: [payer, ownerTokenAccount, account(wallet), mintAccount, systemProgramAccount, tokenProgramAccount],
      data: Uint8Array.of(1), // Create the owner's associated token account idempotently.
    },
    { programAddress: program, accounts, data: withdrawData },
  ];
}

export function serializePositionTransaction(instructions, wallet, { blockhash, lastValidBlockHeight }) {
  addressBytes(blockhash);
  if (!Number.isSafeInteger(lastValidBlockHeight) || lastValidBlockHeight <= 0) throw new Error('Invalid Solana transaction lifetime.');
  const empty = createTransactionMessage({ version: 'legacy' });
  const withPayer = setTransactionMessageFeePayer(wallet, empty);
  const withLifetime = setTransactionMessageLifetimeUsingBlockhash({ blockhash, lastValidBlockHeight: BigInt(lastValidBlockHeight) }, withPayer);
  const message = appendTransactionMessageInstructions(instructions, withLifetime);
  return getBase64EncodedWireTransaction(compileTransaction(message));
}
