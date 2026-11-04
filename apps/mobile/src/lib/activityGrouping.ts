import type { Activity, ActivityKind } from '../types';

const priority: Record<ActivityKind, number> = {
  failed: 0, swap: 1, yield: 2, launch: 3, multisig: 4, nft: 5,
  stake: 6, buy: 7, transfer: 8, balance: 9, unknown: 10,
};

/** Keep one feed card per onchain signature while retaining every watched wallet's net change. */
export function mergeActivities(...groups: Activity[][]): Activity[] {
  const byTransaction = new Map<string, Activity>();
  for (const activity of groups.flat()) {
    const key = activity.signature ? `${activity.chain}:${activity.signature}` : activity.id;
    const current = byTransaction.get(key);
    const impacts = activity.walletImpacts ?? [{
      walletId: activity.walletId, walletName: activity.walletName,
      walletAddress: activity.walletAddress, balanceChanges: activity.metadata?.balanceChanges ?? [],
    }];
    if (!current) {
      byTransaction.set(key, activity);
      continue;
    }
    const currentImpacts = current.walletImpacts ?? [{
      walletId: current.walletId, walletName: current.walletName,
      walletAddress: current.walletAddress, balanceChanges: current.metadata?.balanceChanges ?? [],
    }];
    const walletImpacts = [...new Map([...currentImpacts, ...impacts]
      .map(impact => [impact.walletId, impact] as const)).values()];
    const primary = priority[activity.kind] < priority[current.kind] ? activity : current;
    byTransaction.set(key, {
      ...primary,
      ...(walletImpacts.length > 1 ? { walletImpacts } : {}),
      walletName: walletImpacts.length > 1
        ? `${walletImpacts[0].walletName} + ${walletImpacts.length === 2 ? walletImpacts[1].walletName : `${walletImpacts.length - 1} wallets`}`
        : walletImpacts[0].walletName,
    });
  }
  return [...byTransaction.values()]
    .sort((left, right) => new Date(right.occurredAt).getTime() - new Date(left.occurredAt).getTime());
}
