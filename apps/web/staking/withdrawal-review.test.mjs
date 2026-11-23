import assert from 'node:assert/strict';
import test from 'node:test';
import { confirmWithdrawal, verifyWithdrawalQuote } from './withdrawal-review.mjs';

const quote = {
  wallet: 'wallet', grossRaw: '399', feeRaw: '1', netRaw: '398',
  feeBps: 50, actionFeeLamports: '2000000', networkFeeLamports: '5000',
};

test('accepts only a complete, wallet-bound quote with exact fee and net amounts', () => {
  assert.equal(verifyWithdrawalQuote(quote, 'wallet'), quote);
  assert.doesNotThrow(() => verifyWithdrawalQuote({ ...quote, networkFeeLamports: null }, 'wallet'));
  assert.throws(() => verifyWithdrawalQuote(undefined, 'wallet'));
  assert.throws(() => verifyWithdrawalQuote(quote, 'changed-wallet'));
  assert.throws(() => verifyWithdrawalQuote({ ...quote, feeRaw: '2', netRaw: '397' }, 'wallet'));
  assert.throws(() => verifyWithdrawalQuote({ ...quote, netRaw: '999' }, 'wallet'));
  assert.throws(() => verifyWithdrawalQuote({ ...quote, actionFeeLamports: '1' }, 'wallet'));
});

class ReviewDialog extends EventTarget {
  returnValue = 'approve';
  showModal() {}
  close(value = this.returnValue) {
    this.returnValue = value;
    this.dispatchEvent(new Event('close'));
  }
}

test('does not reuse approval when a second review is dismissed', async () => {
  const dialog = new ReviewDialog();
  const first = confirmWithdrawal(dialog);
  dialog.close('approve');
  assert.equal(await first, 'approve');
  const next = confirmWithdrawal(dialog);
  dialog.close(); // Escape leaves the current return value unchanged.
  assert.equal(await next, 'cancel');
});

test('expires a review instead of approving a stale transaction', async () => {
  assert.equal(await confirmWithdrawal(new ReviewDialog(), 5), 'expired');
});
