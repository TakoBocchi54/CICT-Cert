export function certificateVerificationUrl(hash, origin) {
  if (typeof hash !== 'string' || !/^0x[0-9a-fA-F]{64}$/.test(hash)) {
    throw new Error('Certificate is missing a valid verification hash.');
  }
  const url = new URL('/verify', origin);
  if (!['https:', 'http:'].includes(url.protocol)) throw new Error('Invalid portal address.');
  url.searchParams.set('id', hash);
  return url.href;
}
