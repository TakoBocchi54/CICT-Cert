import test from 'node:test';
import assert from 'node:assert/strict';
import { linkedInCertificationUrl, CERTIFICATE_ISSUER } from './linkedInCertification.js';

const certUrl = 'https://cict-cert.example.edu/verify?id=0x' + 'a'.repeat(64);

test('LinkedIn link prefills the certification with the issuer, number, date and verification link', () => {
  const url = new URL(linkedInCertificationUrl({ name: 'Web Security & Ethics 101', issued: '2026-11-09T07:30:00.000Z', certId: 42, certUrl }));
  assert.equal(url.origin + url.pathname, 'https://www.linkedin.com/profile/add');
  const params = Object.fromEntries(url.searchParams);
  assert.deepEqual(params, { startTask: 'CERTIFICATION_NAME', name: 'Web Security & Ethics 101', organizationName: CERTIFICATE_ISSUER,
    issueYear: '2026', issueMonth: '11', certId: '42', certUrl });
});

test('a bare seminar date keeps its own month, and an unknown date is left out', () => {
  const january = new URL(linkedInCertificationUrl({ name: 'S', issued: '2027-01-01', certId: 1, certUrl }));
  assert.deepEqual([january.searchParams.get('issueYear'), january.searchParams.get('issueMonth')], ['2027', '1']);
  const unknown = new URL(linkedInCertificationUrl({ name: 'S', issued: undefined, certId: 1, certUrl }));
  assert.equal(unknown.searchParams.has('issueYear'), false);
  assert.equal(unknown.searchParams.has('issueMonth'), false);
});
