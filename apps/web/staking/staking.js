import { getBase58Decoder } from '@solana/codecs-strings';
import { getWallets } from '@wallet-standard/app';

const apiOrigin = 'https://api.whoaped.com';
const chain = 'solana:mainnet';
const storageKey = 'whoaped.telegram-staking';
const registry = getWallets();
const element = id => document.getElementById(id);
const walletPicker = element('wallet-picker');
const decodeBase64 = value => Uint8Array.from(atob(value), char => char.charCodeAt(0));
const shorten = address => `${address.slice(0, 6)}…${address.slice(-5)}`;

let saved = {};
try { saved = JSON.parse(sessionStorage.getItem(storageKey) ?? '{}') ?? {}; } catch { /* An expired browser session can be recreated. */ }
let telegramLinked = false;
let status;
let wallet;
let account;
let accounts = [];
let stopWalletEvents;
let busy = false;
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
    telegramLinked = false;
    status = undefined;
    remember({ token: undefined, confirmation: undefined, receipt: undefined });
    throw new Error('This session expired. Connect Telegram again.');
  }
  if (!response.ok) throw new Error(data.error || 'WhoAped is temporarily unavailable.');
  return data;
}

function displayAmount(raw) {
  const amount = BigInt(raw);
  const whole = (amount / 1_000_000n).toLocaleString('en-US');
  const fraction = (amount % 1_000_000n).toString().padStart(6, '0').replace(/0+$/, '');
  return fraction ? `${whole}.${fraction}` : whole;
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

function selectAccounts(nextAccounts) {
  accounts = nextAccounts.filter(item => item.chains.includes(chain)
    && item.features.includes('solana:signMessage') && item.features.includes('solana:signAndSendTransaction'));
  account = accounts.find(item => item.address === account?.address) ?? accounts[0];
  element('wallet-account').replaceChildren(...accounts.map(item =>
    new Option(item.label ? `${item.label} · ${shorten(item.address)}` : item.address, item.address)));
  if (account) element('wallet-account').value = account.address;
}

function positionLabel(position) {
  if (!position.unlockAt) return position.amountRaw === '0' ? 'No stake yet' : 'Locked';
  const deadline = new Date(Number(position.unlockAt) * 1000);
  if (Number.isNaN(deadline.getTime())) return 'Unstaking';
  return Date.now() >= deadline.getTime() ? 'Ready to withdraw' : `Withdrawal opens ${deadline.toLocaleString()}`;
}

function render() {
  const wallets = availableWallets();
  element('wallet-help').hidden = wallets.length > 0;
  element('telegram').hidden = !wallets.length && !saved.token;
  element('position').hidden = !telegramLinked || !status;
  element('refresh').hidden = !saved.token;
  element('refresh').disabled = busy;
  element('telegram-state').textContent = telegramLinked ? 'Telegram connected.' : 'Connect the Telegram account where you want PRO access.';
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
  if (!status) return;

  const pending = busy || Boolean(saved.receipt);
  element('pro').textContent = status.qualifiesForPremium ? 'Stake-based PRO active' : 'Stake-based PRO inactive';
  element('terms').textContent = `Stake ${displayAmount(status.minimumAmountRaw)} WHOAPED in one wallet to get PRO. Track up to 60/min, 1,000/hour and 3,000/day across all wallets.`;
  element('connect-wallet').disabled = pending;
  element('connect-wallet').textContent = account ? 'Change wallet' : 'Connect wallet';
  element('account-label').hidden = !account;
  element('wallet-account').hidden = !account;
  element('wallet-account').disabled = pending;
  const selected = status.positions.find(item => item.wallet === account?.address);
  element('link-wallet').hidden = !account || Boolean(selected);
  element('link-wallet').disabled = pending;
  element('positions').replaceChildren(...status.positions.filter(item => item.amountRaw !== '0').map(item => {
    const row = document.createElement('li');
    row.textContent = `${shorten(item.wallet)} · ${displayAmount(item.amountRaw)} WHOAPED · ${positionLabel(item)}`;
    return row;
  }));
  element('position-state').textContent = account && !selected ? 'Verify that you own this wallet to manage staking.'
    : selected ? `${shorten(selected.wallet)} · ${positionLabel(selected)}` : 'Connect a wallet to manage your position.';
  const form = element('stake-form');
  form.hidden = !selected || Boolean(selected.unlockAt) || status.depositsPaused;
  element('amount').disabled = pending;
  form.querySelector('button').disabled = pending;
  element('unstake').hidden = !selected || selected.amountRaw === '0' || Boolean(selected.unlockAt);
  element('unstake').disabled = pending;
  element('cancel-unstake').hidden = !selected?.unlockAt;
  element('cancel-unstake').disabled = pending;
  element('claim').hidden = !selected?.unlockAt;
  element('claim').disabled = pending || !(Date.now() >= Number(selected?.unlockAt) * 1000);
}

async function refreshStatus() {
  if (!saved.token) return;
  const details = await api('/v1/account');
  telegramLinked = Boolean(details.telegram?.connected);
  if (!telegramLinked) { status = undefined; return; }
  remember({ confirmation: undefined });
  status = undefined;
  const next = await api('/v1/stakefast/status');
  if (next.cluster !== 'mainnet') throw new Error('The mainnet staking vault is unavailable.');
  status = next;
}

async function run(work) {
  if (busy) return;
  busy = true;
  render();
  try {
    await work();
  } catch (error) {
    element('notice').textContent = error instanceof Error ? error.message : 'Try again in your wallet.';
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
  const signer = wallet.features['solana:signAndSendTransaction'];
  element('notice').textContent = 'Approve the transaction in your Solana wallet.';
  const prepared = await api('/v1/stakefast/transactions', { wallet: owner.address, action, amountRaw });
  if (prepared.cluster !== 'mainnet' || prepared.vault !== status.vault || prepared.mint !== status.mint) {
    throw new Error('This transaction does not match the mainnet WHOAPED vault.');
  }
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
  account = accounts.find(item => item.address === element('wallet-account').value);
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
element('stake-form').onsubmit = event => {
  event.preventDefault();
  void run(() => submit('stake', amountInBaseUnits(element('amount').value)));
};
element('unstake').onclick = () => {
  if (confirm('Request unstake? Stake-based PRO ends when this transaction finalizes and the withdrawal cooldown starts.')) void run(() => submit('unstake'));
};
element('cancel-unstake').onclick = () => run(() => submit('cancel'));
element('claim').onclick = () => run(() => submit('claim'));
element('refresh').onclick = () => run(refreshStatus);
document.addEventListener('visibilitychange', () => {
  if (document.visibilityState === 'visible') void run(refreshStatus);
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
