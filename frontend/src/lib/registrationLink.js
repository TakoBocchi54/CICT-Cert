// The page students open to register for a seminar.
export const registrationUrl = (token, origin = window.location.origin) => `${origin}/register/${token}`;

// <input type="datetime-local"> holds local time without a zone; the API takes and returns ISO timestamps.
export function deadlineToInput(iso) {
  if (!iso) return '';
  const date = new Date(iso);
  return new Date(date.getTime() - date.getTimezoneOffset() * 60000).toISOString().slice(0, 16);
}
export const inputToDeadline = value => value ? new Date(value).toISOString() : null;

export const formatDeadline = iso => new Date(iso).toLocaleString('en-US',
  { month: 'short', day: 'numeric', year: 'numeric', hour: 'numeric', minute: '2-digit' });
