// How a certificate number is shown and printed: the certificate's seminar date, then its number, e.g. 20261118-0042.
// Display only: the database, the certificate hash, the contract and URLs keep the plain integer (the hash signs
// String(certificateNo), so the stored value must not change). The number counts across all certificates; the date is
// the certificate's own seminarDate snapshot, so the code never changes once printed.
// The same format is in backend/src/utils/certificateNumber.js.
export function formatCertificateNo(no, seminarDate) {
  if (no === '' || no == null) return '';
  const number = String(no).padStart(4, '0');
  const day = /^\d{4}-\d{2}-\d{2}/.test(seminarDate ?? '') ? seminarDate.slice(0, 10).replaceAll('-', '') : '';
  return day ? `${day}-${number}` : number;
}
