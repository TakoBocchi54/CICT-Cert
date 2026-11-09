import { PDFDocument } from 'pdf-lib';

export async function createCertificatePdf(png, aspectRatio, certificateNo) {
  if (!Number.isFinite(aspectRatio) || aspectRatio <= 0) throw new Error('Invalid certificate proportions.');
  const document = await PDFDocument.create();
  const width = 297 * 72 / 25.4;
  const height = width / aspectRatio;
  const page = document.addPage([width, height]);
  const image = await document.embedPng(png);
  page.drawImage(image, { x: 0, y: 0, width, height });
  document.setTitle(`CICT Certificate ${certificateNo}`);
  return document.save();
}
