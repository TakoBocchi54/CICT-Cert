import test from 'node:test';
import assert from 'node:assert/strict';
import { formatCertificateNo } from './certificateNumber.js';

test('certificate numbers are shown as the seminar date and a four-digit number', () => {
  assert.equal(formatCertificateNo(1, '2026-11-18'), '20261118-0001');
  assert.equal(formatCertificateNo('42', '2026-11-18'), '20261118-0042');
  assert.equal(formatCertificateNo(123456, '2027-01-05'), '20270105-123456', 'longer numbers are never cut');
  assert.equal(formatCertificateNo(42), '0042', 'without a date only the number is shown');
  assert.equal(formatCertificateNo('', '2026-11-18'), '', 'a preview without a number yet stays blank');
  assert.equal(formatCertificateNo(null), '');
});
