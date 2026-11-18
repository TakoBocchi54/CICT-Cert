export const CERTIFICATE_ISSUER = 'College of Information and Communications Technology, University of Batangas';

// LinkedIn's "Add to profile" link for a license or certification, prefilled so the student only confirms it.
// issued: when the certificate was issued (an ISO timestamp or a YYYY-MM-DD seminar date).
export function linkedInCertificationUrl({ name, issued, certId, certUrl }) {
  const url = new URL('https://www.linkedin.com/profile/add');
  url.searchParams.set('startTask', 'CERTIFICATION_NAME');
  url.searchParams.set('name', name);
  url.searchParams.set('organizationName', CERTIFICATE_ISSUER);
  // A bare date would parse as UTC midnight and could fall on the previous day locally; read its parts directly.
  const [, year, month] = /^(\d{4})-(\d{2})-\d{2}$/.exec(issued ?? '') ?? [];
  const date = year ? null : new Date(issued);
  if (year) {
    url.searchParams.set('issueYear', year);
    url.searchParams.set('issueMonth', String(Number(month)));
  } else if (date && Number.isFinite(date.getTime())) {
    url.searchParams.set('issueYear', String(date.getFullYear()));
    url.searchParams.set('issueMonth', String(date.getMonth() + 1));
  }
  url.searchParams.set('certId', String(certId));
  url.searchParams.set('certUrl', certUrl);
  return url.href;
}
