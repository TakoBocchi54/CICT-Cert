import test from 'node:test';
import assert from 'node:assert/strict';
import { CONSENT_TERMS } from './consentTerms.js';
import { walletConsentMessage } from '../../../backend/src/utils/certificateConsent.js';

test('the login consent terms are the text students sign at wallet link', () => {
  const signed = walletConsentMessage('1', 'nonce', '2026-11-16T00:00:00.000Z').split('\n');
  const body = signed.slice(signed.indexOf('') + 1, signed.lastIndexOf('')).join(' ');
  assert.equal(CONSENT_TERMS.join(' '), body);
});
