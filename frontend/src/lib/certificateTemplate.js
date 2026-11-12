// Mirrors backend/src/utils/certificateTemplate.js: the paper is detected from the image proportions (±2%).
const PAPERS = [{ name: 'A4', mm: [297, 210] }, { name: 'Letter', mm: [279.4, 215.9] }];
export const BUILT_IN_PAGE_MM = [297, 210];

export function paperSize(width, height) {
  for (const paper of PAPERS) {
    for (const [orientation, mm] of [['landscape', paper.mm], ['portrait', [paper.mm[1], paper.mm[0]]]]) {
      if (Math.abs(width / height / (mm[0] / mm[1]) - 1) <= 0.02) return { name: paper.name, orientation, mm };
    }
  }
  return null;
}

// PDF page in millimetres for a certificate rendered with this template (or the built-in A4 landscape design).
export const pageSizeMm = template => (template && paperSize(template.width, template.height)?.mm) || BUILT_IN_PAGE_MM;

export const paperLabel = template => {
  const paper = paperSize(template.width, template.height);
  return paper ? `${paper.name} ${paper.orientation}` : `${template.width}×${template.height}`;
};

export const FIELD_LABELS = {
  recipientName: 'Recipient name', seminarTitle: 'Seminar title', seminarDate: 'Seminar date', certificateNo: 'Certificate no.', qr: 'QR code',
};

export const SAMPLE_CERTIFICATE = { id: '000123', recipient: 'Juan Dela Cruz', seminar: 'Sample Seminar on Web Security', iso: new Date().toISOString().slice(0, 10), status: 'Verified' };

export const newSignatureField = signatureID => ({
  signatureID, x: 50, y: 84, width: 18, line: true, name: '', title: '', size: 1.3, font: 'sans', color: '#16231d',
});
