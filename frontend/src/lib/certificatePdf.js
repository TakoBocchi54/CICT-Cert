import { PDFDocument } from 'pdf-lib';

// One page of [widthMm, heightMm] (the template's paper size), filled with the rendered certificate image.
export async function createCertificatePdf(png, pageMm, certificateNo) {
  if (!Array.isArray(pageMm) || !pageMm.every(mm => Number.isFinite(mm) && mm > 0)) throw new Error('Invalid certificate page size.');
  const document = await PDFDocument.create();
  const [width, height] = pageMm.map(mm => mm * 72 / 25.4);
  const page = document.addPage([width, height]);
  const image = await document.embedPng(png);
  page.drawImage(image, { x: 0, y: 0, width, height });
  document.setTitle(`CICT Certificate ${certificateNo}`);
  return document.save();
}
