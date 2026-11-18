// Polygonscan pages for Polygon Amoy (chain 80002), where anyone can check a record without this site.
const BASE = 'https://amoy.polygonscan.com';

export const polygonscan = {
  tx: hash => `${BASE}/tx/${hash}`,
  address: address => `${BASE}/address/${address}`,
  token: (contract, tokenId) => `${BASE}/nft/${contract}/${tokenId}`,
};
