const total = document.getElementById('staking-total');
const retry = document.getElementById('staking-total-retry');

async function loadStakingTotal() {
  retry.hidden = true;
  total.textContent = 'Loading…';
  try {
    const response = await fetch('/api/staking-stats/', { signal: AbortSignal.timeout(10_000) });
    if (!response.ok) throw new Error('Could not load the staking total.');
    const { amountRaw, decimals } = await response.json();
    if (decimals !== 6 || typeof amountRaw !== 'string' || !/^\d{1,20}$/.test(amountRaw)) {
      throw new Error('Invalid staking total.');
    }
    const digits = amountRaw.padStart(decimals + 1, '0');
    const whole = BigInt(digits.slice(0, -decimals)).toLocaleString('en-US');
    const fraction = digits.slice(-decimals).replace(/0+$/, '');
    total.textContent = fraction ? `${whole}.${fraction}` : whole;
  } catch {
    total.textContent = 'Unavailable';
    retry.hidden = false;
  }
}

retry.addEventListener('click', loadStakingTotal);
void loadStakingTotal();
