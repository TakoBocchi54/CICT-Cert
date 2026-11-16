import test from 'node:test';
import assert from 'node:assert/strict';
import { registrationUrl, deadlineToInput, inputToDeadline } from './registrationLink.js';

test('registration deadline round-trips between the local input value and ISO', () => {
  assert.equal(deadlineToInput(null), '');
  assert.equal(inputToDeadline(''), null);
  for (const value of ['2026-12-01T17:30', '2027-01-01T00:00']) {
    assert.equal(deadlineToInput(inputToDeadline(value)), value);
  }
});

test('registration link uses the given origin and token', () => {
  assert.equal(registrationUrl('abc', 'https://cert.example'), 'https://cert.example/register/abc');
});
