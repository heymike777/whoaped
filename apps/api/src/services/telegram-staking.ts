import { seekerStakingOffer, stakeFastConfig } from '../config/stakefast.js';
import type { Collections } from '../db.js';
import { canonicalAccountId } from './accounts.js';
import { paidPremiumAccess } from './premium-access.js';
import { PREMIUM_TRANSACTION_LIMITS } from './rate-limits.js';
import { stakeFastStatus } from './stakefast.js';

export const TELEGRAM_STAKING_URL = 'https://whoaped.com/staking/';
export const telegramStakingEnabled = () =>
  process.env.TELEGRAM_STAKING_ENABLED === 'true' && process.env.STAKEFAST_DEVNET_ENABLED !== 'true';

function formatWhoAped(raw: string) {
  const amount = BigInt(raw);
  const whole = (amount / 1_000_000n).toLocaleString('en-US');
  const fraction = (amount % 1_000_000n).toString().padStart(6, '0').replace(/0+$/, '');
  return fraction ? `${whole}.${fraction}` : whole;
}

export async function telegramStakingSummary(userId: string, db: Collections) {
  const config = stakeFastConfig();
  const accountId = await canonicalAccountId(userId, db);
  const [paid, stake] = await Promise.all([
    paidPremiumAccess(accountId, db),
    stakeFastStatus(accountId, config).catch(() => null),
  ]);
  const pro = stake?.qualifiesForPremium ? 'PRO active through staking.'
    : paid.active ? 'PRO active through your paid access.'
    : stake ? 'PRO inactive.' : 'Staking status is temporarily unavailable.';
  const positions = stake?.positions.filter(position => position.amountRaw !== '0') ?? [];
  const rows = positions.slice(0, 6).map(({ wallet, amountRaw, unlockAt }) => {
    const deadline = unlockAt ? new Date(Number(unlockAt) * 1000) : null;
    const state = deadline === null ? 'locked'
      : Number.isNaN(deadline.getTime()) ? 'unstaking'
      : deadline.getTime() <= Date.now() ? 'ready to withdraw'
      : `withdrawal opens ${deadline.toISOString().slice(0, 16).replace('T', ' ')} UTC`;
    return `${wallet.slice(0, 6)}…${wallet.slice(-5)} · ${formatWhoAped(amountRaw)} WHOAPED · ${state}`;
  });
  const threshold = formatWhoAped(stake?.minimumAmountRaw ?? config.proMinimumRaw.toString());
  const limits = PREMIUM_TRANSACTION_LIMITS.map(({ name, limit }) => `${limit.toLocaleString('en-US')}/${name}`).join(' · ');
  const cooldown = BigInt(stake?.cooldownSeconds ?? seekerStakingOffer().cooldownSeconds);
  const wait = cooldown % 86_400n === 0n ? `${cooldown / 86_400n} days` : `${cooldown.toLocaleString('en-US')} seconds`;
  return [
    '$WHOAPED staking · Solana mainnet',
    pro,
    ...(stake ? [rows.join('\n') || 'No linked staking positions yet.'] : []),
    ...(positions.length > rows.length ? ['Open staking to view all positions.'] : []),
    `Stake ${threshold} WHOAPED in one wallet to get PRO. Track up to ${limits} across all wallets.`,
    `Stake-based PRO ends when the unstake request finalizes. Withdraw after ${wait}.`,
    'StakeFast charges 0.002 SOL per action, plus network fees and any token account rent. The 0.5% WHOAPED fee applies only when you withdraw.',
    'Open staking to connect Telegram and approve transactions in your Solana wallet.',
  ].join('\n\n');
}
