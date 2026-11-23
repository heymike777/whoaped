const baseUnits = value => typeof value === 'string' && /^(?:0|[1-9][0-9]{0,19})$/.test(value) && BigInt(value) <= 0xffff_ffff_ffff_ffffn;

export function verifyWithdrawalQuote(quote, wallet) {
  if (!quote || quote.wallet !== wallet || quote.feeBps !== 50 || quote.actionFeeLamports !== '2000000'
    || ![quote.grossRaw, quote.feeRaw, quote.netRaw].every(baseUnits)
    || quote.networkFeeLamports !== null && !baseUnits(quote.networkFeeLamports)) {
    throw new Error('The withdrawal quote is unavailable. Try preparing the withdrawal again.');
  }
  const gross = BigInt(quote.grossRaw);
  const fee = BigInt(quote.feeRaw);
  if (!gross || fee !== gross / 200n || BigInt(quote.netRaw) !== gross - fee) {
    throw new Error('The withdrawal amounts do not match the fee schedule. Try again.');
  }
  return quote;
}

export function confirmWithdrawal(dialog, timeoutMs = 35_000) {
  return new Promise((resolve) => {
    // Escape keeps the return value from the last close in some browsers.
    // Reset it before every review so only this review's button can authorize signing.
    dialog.returnValue = 'cancel';
    dialog.showModal();
    const timer = setTimeout(() => dialog.close('expired'), timeoutMs);
    dialog.addEventListener('close', () => {
      clearTimeout(timer);
      resolve(dialog.returnValue);
    }, { once: true });
  });
}
