import test from 'node:test';
import assert from 'node:assert/strict';
import { certificateVerificationUrl } from './certificateVerificationUrl.js';

const hash = '0x' + 'a'.repeat(64);

test('certificate QR links to public verification with the exact certificate hash', () => {
  assert.equal(certificateVerificationUrl(hash, 'https://certificates.example.edu'), `https://certificates.example.edu/verify?id=${hash}`);
  const local = new URL(certificateVerificationUrl(hash, 'http://localhost:5173'));
  assert.equal(local.pathname, '/verify');
  assert.equal(local.searchParams.get('id'), hash);
  assert.deepEqual([...local.searchParams.keys()], ['id']);
});

test('missing or malformed certificate hashes cannot produce QR verification links', () => {
  for (const value of ['', undefined, null, 'certificate-1', '0x' + 'a'.repeat(63), hash + '&email=student@example.edu']) {
    assert.throws(() => certificateVerificationUrl(value, 'https://certificates.example.edu'), /valid verification hash/);
  }
  assert.throws(() => certificateVerificationUrl(hash, 'ftp://certificates.example.edu'), /Invalid portal address/);
});
