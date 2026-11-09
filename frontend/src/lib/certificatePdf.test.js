import test from 'node:test';
import assert from 'node:assert/strict';
import { PDFDocument } from 'pdf-lib';
import { createCertificatePdf } from './certificatePdf.js';

const png = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAusB9Wl6SAAAAABJRU5ErkJggg==';

test('direct PDF contains one certificate page with the template proportions and no clickable annotations', async () => {
  const bytes = await createCertificatePdf(png, 1.414, '1234567890123456789');
  const pdf = await PDFDocument.load(bytes);
  assert.equal(pdf.getPageCount(), 1);
  const page = pdf.getPage(0);
  assert.ok(Math.abs(page.getWidth() * 25.4 / 72 - 297) < 0.0001);
  assert.ok(Math.abs(page.getWidth() / page.getHeight() - 1.414) < 0.0001);
  assert.equal(pdf.getTitle(), 'CICT Certificate 1234567890123456789');
  assert.equal(page.node.Annots()?.size() ?? 0, 0);
});

test('invalid proportions and failed image generation cannot create an empty certificate PDF', async () => {
  for (const ratio of [0, -1, NaN, Infinity]) await assert.rejects(createCertificatePdf(png, ratio, '1'), /Invalid certificate proportions/);
  await assert.rejects(createCertificatePdf('invalid image', 1.414, '1'));
});
