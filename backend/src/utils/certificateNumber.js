// How a certificate number is shown in messages: the certificate's seminar date, then its number, e.g. 20261118-0042.
// Display only: the column, the certificate hash (certificateConsent.js signs String(certificateNo)) and every URL keep
// the plain integer. The number counts across all certificates; the date is the certificate's own seminarDate snapshot.
// The same format is in frontend/src/lib/certificateNumber.js.
export function formatCertificateNo(no, seminarDate) {
  const number = String(no).padStart(4, "0");
  const day = /^\d{4}-\d{2}-\d{2}/.test(seminarDate ?? "") ? seminarDate.slice(0, 10).replaceAll("-", "") : "";
  return day ? `${day}-${number}` : number;
}

// Registry search: "20261118-0042", "#42", "0042" and "42" all mean certificate 42 (the number alone is unique).
export const parseCertificateNoQuery = q => q.replace(/^#/, "").replace(/^\d{8}-/, "").replace(/^0+(?=\d)/, "");
