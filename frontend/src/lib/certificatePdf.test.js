import test from 'node:test';
import assert from 'node:assert/strict';
import { PDFDocument } from 'pdf-lib';
import { createCertificatePdf } from './certificatePdf.js';
import { pageSizeMm, paperSize } from './certificateTemplate.js';

const png = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAusB9Wl6SAAAAABJRU5ErkJggg==';
const mm = points => points * 25.4 / 72;

test('direct PDF contains one certificate page of the given paper size and no clickable annotations', async () => {
  const bytes = await createCertificatePdf(png, [297, 210], '1234567890123456789');
  const pdf = await PDFDocument.load(bytes);
  assert.equal(pdf.getPageCount(), 1);
  const page = pdf.getPage(0);
  assert.ok(Math.abs(mm(page.getWidth()) - 297) < 0.0001);
  assert.ok(Math.abs(mm(page.getHeight()) - 210) < 0.0001);
  assert.equal(pdf.getTitle(), 'CICT Certificate 1234567890123456789');
  assert.equal(page.node.Annots()?.size() ?? 0, 0);

  const letter = (await PDFDocument.load(await createCertificatePdf(png, pageSizeMm({ width: 1275, height: 1650 }), '1'))).getPage(0);
  assert.ok(Math.abs(mm(letter.getWidth()) - 215.9) < 0.0001 && Math.abs(mm(letter.getHeight()) - 279.4) < 0.0001);
});

test('templates map to their paper size; the built-in design and unknown proportions use A4 landscape', () => {
  assert.deepEqual(pageSizeMm(null), [297, 210]);
  assert.deepEqual(pageSizeMm({ width: 1240, height: 1754 }), [210, 297]);
  assert.deepEqual(pageSizeMm({ width: 3300, height: 2550 }), [279.4, 215.9]);
  assert.deepEqual(pageSizeMm({ width: 2000, height: 1000 }), [297, 210]);
  assert.equal(paperSize(2000, 1000), null);
});

test('invalid page sizes and failed image generation cannot create an empty certificate PDF', async () => {
  for (const page of [undefined, 1.414, [0, 210], [297, NaN], [-1, 210]]) {
    await assert.rejects(createCertificatePdf(png, page, '1'), /Invalid certificate page size/);
  }
  await assert.rejects(createCertificatePdf('invalid image', [297, 210], '1'));
});
