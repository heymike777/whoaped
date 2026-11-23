import { getBase58Decoder } from '@solana/codecs-strings';
import { getWallets } from '@wallet-standard/app';
import { confirmWithdrawal, verifyWithdrawalQuote } from './withdrawal-review.mjs';

const apiOrigin = 'https://api.whoaped.com';
const chain = 'solana:mainnet';
const storageKey = 'whoaped.telegram-staking';
const registry = getWallets();
const element = id => document.getElementById(id);
const walletPicker = element('wallet-picker');
const unstakeDialog = element('unstake-dialog');
const withdrawalDialog = element('withdrawal-dialog');
const decodeBase64 = value => Uint8Array.from(atob(value), char => char.charCodeAt(0));
const shorten = address => `${address.slice(0, 6)}…${address.slice(-5)}`;

let saved = {};
try { saved = JSON.parse(sessionStorage.getItem(storageKey) ?? '{}') ?? {}; } catch { /* An expired browser session can be recreated. */ }
let telegramAccount;
let status;
let wallet;
let account;
let accounts = [];
let walletBalances;
let balancesUnavailable = false;
let balanceRequest = 0;
let stopWalletEvents;
let busy = false;
let jupiterOpened = false;
let pollTimer;
let lastSignature = saved.receipt?.signature;

function remember(changes) {
  saved = { ...saved, ...changes };
  try { sessionStorage.setItem(storageKey, JSON.stringify(saved)); } catch { /* The flow can continue in this tab. */ }
}

async function api(path, body) {
  const response = await fetch(apiOrigin + path, {
    method: body === undefined ? 'GET' : 'POST',
    headers: {
      ...(saved.token ? { Authorization: 'Bearer ' + saved.token } : {}),
      ...(body === undefined ? {} : { 'Content-Type': 'application/json' }),
    },
    credentials: 'omit',
    cache: 'no-store',
    body: body === undefined ? undefined : JSON.stringify(body),
    signal: AbortSignal.timeout(15_000),
  });
  const data = await response.json().catch(() => ({}));
  if (response.status === 401) {
    telegramAccount = undefined;
    status = undefined;
    remember({ token: undefined, confirmation: undefined, receipt: undefined });
    throw new Error('This session expired. Connect Telegram again.');
  }
  if (!response.ok) throw new Error(data.error || 'WhoAped is temporarily unavailable.');
  return data;
}

function decimalAmount(raw, decimals = 6) {
  const digits = raw.padStart(decimals + 1, '0');
  const whole = digits.slice(0, -decimals);
  const fraction = digits.slice(-decimals).replace(/0+$/, '');
  return fraction ? `${whole}.${fraction}` : whole;
}

function displayAmount(raw, decimals = 6) {
  const [whole, fraction] = decimalAmount(raw, decimals).split('.');
  const formatted = BigInt(whole).toLocaleString('en-US');
  return fraction ? `${formatted}.${fraction}` : formatted;
}

function amountInBaseUnits(value) {
  const match = /^(\d{1,14})(?:[.,](\d{1,6}))?$/.exec(value.trim());
  if (!match) throw new Error('Enter a WHOAPED amount with up to six decimal places.');
  const raw = BigInt(match[1] + (match[2] ?? '').padEnd(6, '0'));
  if (!raw || raw > 0xffff_ffff_ffff_ffffn) throw new Error('Enter a positive WHOAPED amount in range.');
  return raw.toString();
}

function availableWallets() {
  return registry.get().filter(item => item.chains.includes(chain)
    && item.features['standard:connect'] && item.features['solana:signMessage']
    && item.features['solana:signAndSendTransaction']?.supportedTransactionVersions.includes('legacy'));
}

function selectWalletAccount(next) {
  const changed = account?.address !== next?.address;
  account = next;
  element('staking-error').hidden = true;
  if (changed) {
    element('amount').value = '';
    void refreshWalletBalances();
  }
}

function selectAccounts(nextAccounts) {
  accounts = nextAccounts.filter(item => item.chains.includes(chain)
    && item.features.includes('solana:signMessage') && item.features.includes('solana:signAndSendTransaction'));
  const selected = accounts.find(item => item.address === account?.address) ?? accounts[0];
  element('wallet-account').replaceChildren(...accounts.map(item => {
    const address = shorten(item.address);
    const option = new Option(item.label ? `${item.label} · ${address}` : address, item.address);
    option.title = item.address;
    return option;
  }));
  selectWalletAccount(selected);
  if (account) element('wallet-account').value = account.address;
}

function positionLabel(position) {
  if (!position.unlockAt) return position.amountRaw === '0' ? 'No stake yet' : 'Locked';
  const deadline = new Date(Number(position.unlockAt) * 1000);
  if (Number.isNaN(deadline.getTime())) return 'Unstaking';
  return Date.now() >= deadline.getTime() ? 'Ready to withdraw' : `Withdrawal opens ${deadline.toLocaleString()}`;
}

function withdrawalWait(raw = '604800') {
  const seconds = BigInt(raw);
  if (seconds === 0n) return 'as soon as';
  const units = [[86_400n, 'day'], [3_600n, 'hour'], [60n, 'minute'], [1n, 'second']];
  const [size, unit] = units.find(([size]) => seconds % size === 0n);
  const amount = seconds / size;
  return `${amount.toLocaleString('en-US')} ${unit}${amount === 1n ? '' : 's'} after`;
}

function render() {
  const wallets = availableWallets();
  const telegramLinked = Boolean(telegramAccount);
  const username = telegramAccount?.username?.trim().replace(/^@+/, '');
  element('wallet-help').hidden = wallets.length > 0;
  element('telegram').hidden = !wallets.length && !saved.token;
  element('telegram').dataset.connected = String(telegramLinked);
  element('telegram-connected').hidden = !telegramLinked;
  element('telegram-username').hidden = !username;
  element('telegram-username').textContent = username ? `@${username}` : '';
  element('telegram-state').hidden = telegramLinked;
  element('position').hidden = !telegramLinked || !status;
  element('refresh').hidden = !saved.token;
  element('refresh').disabled = busy;
  element('connect-telegram').hidden = telegramLinked;
  element('connect-telegram').disabled = busy;
  const confirmation = saved.confirmation;
  element('telegram-confirmation').hidden = telegramLinked || !confirmation;
  if (confirmation && !telegramLinked) {
    element('telegram-code').textContent = confirmation.code;
    element('confirm-telegram').href = confirmation.url;
  }

  element('receipt').hidden = !lastSignature;
  if (lastSignature) element('receipt').href = 'https://explorer.solana.com/tx/' + encodeURIComponent(lastSignature);
  const pending = busy || Boolean(saved.receipt);
  element('confirm-unstake').disabled = pending || !status;
  const wait = withdrawalWait(status?.cooldownSeconds);
  element('withdrawal-wait').textContent = wait;
  element('unstake-wait').textContent = wait;
  element('pro').hidden = !status;
  if (!status) return;

  element('pro').textContent = status.qualifiesForPremium ? 'Stake-based PRO active' : 'Stake-based PRO inactive';
  element('pro').dataset.active = String(status.qualifiesForPremium);
  element('pro-minimum').textContent = `${displayAmount(status.minimumAmountRaw)} WHOAPED`;
  element('connect-wallet').disabled = pending;
  element('connect-wallet').textContent = account ? 'Change wallet' : 'Connect wallet';
  element('connect-wallet').classList.toggle('button-ink', !account);
  element('connect-wallet').classList.toggle('button-outline', Boolean(account));
  element('wallet-account-field').hidden = !account;
  element('wallet-account').disabled = pending;
  element('wallet-account').title = account?.address ?? '';
  element('wallet-balances').hidden = !account;
  element('wallet-balance-values').hidden = !walletBalances;
  element('wallet-balance-message').hidden = Boolean(walletBalances);
  element('wallet-balance-message').textContent = balancesUnavailable
    ? 'Wallet balances are unavailable. Refresh status to try again.'
    : 'Loading wallet balances…';
  if (walletBalances) {
    element('whoaped-balance').textContent = displayAmount(walletBalances.whoapedAmountRaw);
    element('sol-balance').textContent = displayAmount(walletBalances.solLamports, 9);
  }
  const selected = status.positions.find(item => item.wallet === account?.address);
  element('link-wallet').hidden = !account || Boolean(selected);
  element('link-wallet').disabled = pending;
  element('positions').replaceChildren(...status.positions.filter(item => item.amountRaw !== '0').map(item => {
    const row = document.createElement('li');
    const address = document.createElement('span');
    address.className = 'staking-position-wallet';
    address.textContent = shorten(item.wallet);
    address.title = item.wallet;
    const amount = document.createElement('strong');
    amount.className = 'staking-position-amount';
    amount.textContent = `${displayAmount(item.amountRaw)} WHOAPED`;
    const state = document.createElement('span');
    state.className = 'staking-position-status';
    state.textContent = positionLabel(item);
    row.append(address, amount, state);
    return row;
  }));
  element('position-state').textContent = account && !selected ? 'Verify that you own this wallet to manage staking.'
    : selected ? `${shorten(selected.wallet)} · ${positionLabel(selected)}` : 'Connect a wallet to manage your position.';
  const form = element('stake-form');
  form.hidden = !selected || Boolean(selected.unlockAt) || status.depositsPaused;
  element('amount').disabled = pending;
  form.querySelector('button[type="submit"]').disabled = pending;
  element('stake-max').disabled = pending || !walletBalances || walletBalances.whoapedAmountRaw === '0';
  element('unstake').hidden = !selected || selected.amountRaw === '0' || Boolean(selected.unlockAt);
  element('unstake').disabled = pending;
  element('cancel-unstake').hidden = !selected?.unlockAt;
  element('cancel-unstake').disabled = pending;
  element('claim').hidden = !selected?.unlockAt;
  element('claim').disabled = pending || !(Date.now() >= Number(selected?.unlockAt) * 1000);
}

async function refreshWalletBalances() {
  const request = ++balanceRequest;
  const address = account?.address;
  walletBalances = undefined;
  balancesUnavailable = false;
  render();
  if (!address || !saved.token) return;

  try {
    const balances = await api(`/v1/stakefast/wallets/${encodeURIComponent(address)}/balances`);
    if (request !== balanceRequest) return;
    if (balances.wallet !== address || balances.cluster !== 'mainnet' || balances.mint !== status?.mint) {
      throw new Error('Balance response does not match the selected wallet.');
    }
    walletBalances = balances;
  } catch {
    if (request !== balanceRequest) return;
    balancesUnavailable = true;
  }
  render();
}

async function refreshStatus() {
  if (!saved.token) return;
  const details = await api('/v1/account');
  telegramAccount = details.telegram?.connected ? details.telegram : undefined;
  if (!telegramAccount) { status = undefined; return; }
  remember({ confirmation: undefined });
  status = undefined;
  const next = await api('/v1/stakefast/status');
  if (next.cluster !== 'mainnet') throw new Error('The mainnet staking vault is unavailable.');
  status = next;
  if (account) void refreshWalletBalances();
}

async function run(work, errorOutput = element('notice')) {
  if (busy) return;
  busy = true;
  render();
  try {
    await work();
  } catch (error) {
    element('notice').textContent = '';
    errorOutput.textContent = error instanceof Error ? error.message : 'Try again in your wallet.';
    errorOutput.hidden = false;
  } finally {
    busy = false;
    render();
  }
}

async function pollReceipt() {
  clearTimeout(pollTimer);
  if (!saved.receipt) return;
  if (busy) {
    pollTimer = setTimeout(pollReceipt, 2500);
    return;
  }
  const { signature, lastValidBlockHeight } = saved.receipt;
  try {
    const result = await api(`/v1/stakefast/transactions/${encodeURIComponent(signature)}?lastValidBlockHeight=${lastValidBlockHeight}`);
    if (result.status !== 'pending' && !busy) {
      remember({ receipt: undefined });
      element('notice').textContent = result.status === 'finalized' ? 'Transaction finalized.'
        : result.status === 'expired' ? 'Transaction expired. Refresh your position before trying again.'
        : 'Transaction failed. Check the receipt before trying again.';
      await run(refreshStatus);
      return;
    }
  } catch {
    if (!saved.receipt) render();
    else element('notice').textContent = 'Waiting to verify the transaction on Solana.';
  }
  if (saved.receipt) pollTimer = setTimeout(pollReceipt, 3500);
}

async function submit(action, amountRaw) {
  if (!status || !wallet || !account || saved.receipt || !status.positions.some(item => item.wallet === account.address)) return;
  const owner = account;
  const selectedWallet = wallet;
  const signer = selectedWallet.features['solana:signAndSendTransaction'];
  element('notice').textContent = 'Checking wallet balances…';
  const prepared = await api('/v1/stakefast/transactions', { wallet: owner.address, action, amountRaw });
  if (prepared.cluster !== 'mainnet' || prepared.vault !== status.vault || prepared.mint !== status.mint) {
    throw new Error('This transaction does not match the mainnet WHOAPED vault.');
  }
  if (prepared.preflightChecked !== true) throw new Error('The balance check is temporarily unavailable. Try again shortly.');
  if (selectedWallet !== wallet || owner.address !== account?.address) throw new Error('Your wallet account changed. Try again.');
  if (action === 'claim') {
    const quote = verifyWithdrawalQuote(prepared.withdrawal, owner.address);
    element('withdrawal-gross').textContent = displayAmount(quote.grossRaw) + ' WHOAPED';
    element('withdrawal-fee').textContent = displayAmount(quote.feeRaw) + ' WHOAPED';
    element('withdrawal-net').textContent = displayAmount(quote.netRaw) + ' WHOAPED';
    element('withdrawal-sol-fee').textContent = displayAmount(quote.actionFeeLamports, 9) + ' SOL';
    element('withdrawal-network-fee').textContent = quote.networkFeeLamports === null ? 'Shown by wallet'
      : displayAmount(quote.networkFeeLamports, 9) + ' SOL';
    element('withdrawal-wallet').textContent = shorten(owner.address);
    element('withdrawal-wallet').title = owner.address;
    element('notice').textContent = '';
    const decision = await confirmWithdrawal(withdrawalDialog);
    if (decision === 'expired') throw new Error('The withdrawal quote expired. Open Withdraw to review a fresh quote.');
    if (decision !== 'approve') return;
    if (selectedWallet !== wallet || owner.address !== account?.address) throw new Error('Your wallet account changed. Try again.');
  }
  element('notice').textContent = 'Approve the transaction in your Solana wallet.';
  const [receipt] = await signer.signAndSendTransaction({
    account: owner,
    chain,
    transaction: decodeBase64(prepared.transaction),
    options: { preflightCommitment: 'confirmed', skipPreflight: false },
  }).catch(() => { throw new Error('The wallet did not return a receipt. Check your wallet activity and refresh your position before retrying.'); });
  if (receipt?.signature?.length !== 64) throw new Error('No valid receipt. Check your wallet activity before retrying.');
  lastSignature = getBase58Decoder().decode(receipt.signature);
  remember({ receipt: { signature: lastSignature, lastValidBlockHeight: prepared.lastValidBlockHeight } });
  element('notice').textContent = 'Waiting for Solana finalization…';
  void pollReceipt();
}

const phantomUrl = `https://phantom.com/ul/browse/${encodeURIComponent(location.origin + '/staking/')}?ref=${encodeURIComponent(location.origin)}`;
element('open-phantom').href = phantomUrl;
element('wallet-picker-phantom').href = phantomUrl;
element('connect-telegram').onclick = () => run(async () => {
  if (!saved.token) remember({ token: (await api('/v1/sessions', {})).token });
  const confirmation = await api('/v1/account/telegram-link', {});
  remember({ confirmation });
  element('notice').textContent = '';
});
function connectWallet(next) {
  if (busy || saved.receipt || !availableWallets().includes(next)) return;
  walletPicker.close();
  return run(async () => {
    element('notice').textContent = `Opening ${next.name}…`;
    const authorization = await next.features['standard:connect'].connect();
    stopWalletEvents?.();
    wallet = next;
    selectAccounts(authorization.accounts);
    stopWalletEvents = wallet.features['standard:events']?.on('change', event => {
      if (event.accounts) { selectAccounts(event.accounts); render(); }
    });
    if (!account) throw new Error('Select a Solana account with message and transaction signing.');
    element('notice').textContent = '';
  });
}

function renderWalletPicker() {
  const wallets = availableWallets();
  element('wallet-options').replaceChildren(...wallets.map(next => {
    const button = document.createElement('button');
    button.type = 'button';
    button.className = 'button button-outline';
    button.textContent = next.name;
    button.onclick = () => connectWallet(next);
    return button;
  }));
  element('wallet-picker-empty').hidden = wallets.length > 0;
}

element('connect-wallet').onclick = event => {
  renderWalletPicker();
  event.currentTarget.focus();
  walletPicker.showModal();
};
element('close-wallet-picker').onclick = () => walletPicker.close();
walletPicker.addEventListener('click', event => {
  if (event.target === walletPicker) walletPicker.close();
});
element('wallet-account').onchange = () => {
  selectWalletAccount(accounts.find(item => item.address === element('wallet-account').value));
  render();
};
element('link-wallet').onclick = () => run(async () => {
  if (!wallet || !account || saved.receipt) return;
  const owner = account;
  const signer = wallet.features['solana:signMessage'];
  element('notice').textContent = 'Approve the ownership message in your wallet.';
  const challenge = await api('/v1/stakefast/challenges', { wallet: owner.address });
  const message = decodeBase64(challenge.messageBase64);
  const [proof] = await signer.signMessage({ account: owner, message });
  if (proof?.signature?.length !== 64 || proof.signedMessage?.length !== message.length
    || !message.every((byte, index) => byte === proof.signedMessage[index])) {
    throw new Error('The wallet did not sign the expected ownership message.');
  }
  await api('/v1/stakefast/link', { challengeId: challenge.challengeId, signature: btoa(String.fromCharCode(...proof.signature)) });
  await refreshStatus();
  element('notice').textContent = 'Wallet verified.';
});
function runStakingAction(work) {
  const errorOutput = element('staking-error');
  return run(async () => {
    errorOutput.hidden = true;
    await work();
  }, errorOutput);
}

element('stake-form').onsubmit = event => {
  event.preventDefault();
  void runStakingAction(() => submit('stake', amountInBaseUnits(element('amount').value)));
};
element('stake-max').onclick = () => {
  if (!walletBalances) return;
  element('amount').value = decimalAmount(walletBalances.whoapedAmountRaw);
  element('staking-error').hidden = true;
};
element('unstake').onclick = event => {
  const position = status?.positions.find(item => item.wallet === account?.address);
  if (!position || position.amountRaw === '0' || position.unlockAt) return;
  const selectedWallet = wallet;
  element('unstake-amount').textContent = `${displayAmount(position.amountRaw)} WHOAPED`;
  element('unstake-wallet').textContent = shorten(position.wallet);
  element('unstake-wallet').title = position.wallet;
  element('confirm-unstake').onclick = () => {
    unstakeDialog.close();
    void runStakingAction(() => {
      const current = status?.positions.find(item => item.wallet === account?.address);
      if (wallet !== selectedWallet || current?.wallet !== position.wallet || current.amountRaw !== position.amountRaw || current.unlockAt) {
        throw new Error('Your staking position changed. Review it before requesting unstake.');
      }
      return submit('unstake');
    });
  };
  event.currentTarget.focus();
  unstakeDialog.showModal();
};
element('close-unstake-dialog').onclick = () => unstakeDialog.close();
unstakeDialog.addEventListener('click', event => {
  if (event.target === unstakeDialog) unstakeDialog.close();
});
element('cancel-unstake').onclick = () => runStakingAction(() => submit('cancel'));
element('close-withdrawal-dialog').onclick = () => withdrawalDialog.close('cancel');
element('confirm-withdrawal').onclick = () => withdrawalDialog.close('approve');
withdrawalDialog.addEventListener('click', event => {
  if (event.target === withdrawalDialog) withdrawalDialog.close('cancel');
});
element('claim').onclick = async event => {
  const button = event.currentTarget;
  await runStakingAction(() => submit('claim'));
  if (!button.disabled && !button.hidden) button.focus();
};
element('refresh').onclick = () => run(refreshStatus);
element('buy-whoaped').onclick = () => { jupiterOpened = true; };

function refreshOnReturn() {
  if (document.visibilityState !== 'visible') return;
  const refreshDuringAction = jupiterOpened && busy && account && status;
  jupiterOpened = false;
  if (refreshDuringAction) void refreshWalletBalances();
  else void run(refreshStatus);
}

document.addEventListener('visibilitychange', refreshOnReturn);
window.addEventListener('focus', () => {
  if (jupiterOpened) refreshOnReturn();
});
window.addEventListener('pageshow', event => {
  if (event.persisted && jupiterOpened) refreshOnReturn();
});
function onWalletsChanged() {
  render();
  if (walletPicker.open) renderWalletPicker();
}

registry.on('register', onWalletsChanged);
registry.on('unregister', (...removed) => {
  if (removed.includes(wallet)) { stopWalletEvents?.(); wallet = undefined; selectAccounts([]); }
  onWalletsChanged();
});
render();
void run(refreshStatus);
void pollReceipt();
