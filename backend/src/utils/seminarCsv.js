import { parse } from "csv-parse/sync";

export class CsvError extends Error {}
export const MAX_CSV_BYTES = 1024 * 1024;

function readRows(csv, required) {
  if (typeof csv !== "string" || !csv.trim() || Buffer.byteLength(csv, "utf8") > MAX_CSV_BYTES) {
    throw new CsvError("Choose a non-empty CSV file up to 1 MB.");
  }
  let records;
  try {
    records = parse(csv, {
      bom: true,
      trim: true,
      skip_empty_lines: true,
      max_record_size: 65536,
      columns(headers) {
        headers = headers.map(header => header.trim().toLowerCase());
        if (required.some(name => headers.filter(header => header === name).length !== 1)) {
          throw new CsvError(`CSV must contain ${required.join(", ")} exactly once each.`);
        }
        return headers.map(header => required.includes(header) ? header : false);
      },
    });
  } catch (err) {
    if (err instanceof CsvError) throw err;
    throw new CsvError("Could not read the CSV. Check quotes and the number of columns in each row.");
  }
  if (!records.length) throw new CsvError("The CSV contains no student records.");
  return records;
}

function googleEmail(value, index) {
  const email = value.trim().toLowerCase();
  if (email.length > 255 || /[\u0000-\u001f\u007f]/.test(email) || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
    throw new CsvError(`CSV record ${index + 1}: enter a valid Google account email.`);
  }
  return email;
}

export function readRegistrationCsv(csv) {
  const records = readRows(csv, ["full_name", "program", "google_account"]);

  const students = new Map();
  for (const [index, record] of records.entries()) {
    const student = {
      full_name: record.full_name.trim(),
      program: record.program.trim(),
      google_account: googleEmail(record.google_account, index),
    };
    if (Object.values(student).some(value => !value || value.length > 255 || /[\u0000-\u001f\u007f]/.test(value))) {
      throw new CsvError(`CSV record ${index + 1}: name, program, and Google email must each contain 1–255 characters without line breaks or control characters.`);
    }
    const previous = students.get(student.google_account);
    if (previous && (previous.full_name !== student.full_name || previous.program !== student.program)) {
      throw new CsvError(`CSV record ${index + 1}: a repeated email has conflicting names or programs. Correct the CSV before importing.`);
    }
    students.set(student.google_account, student);
  }
  return { students: [...students.values()], duplicatesSkipped: records.length - students.size };
}

export function readAttendanceCsv(csv) {
  const records = readRows(csv, ["google_account"]);
  const emails = [...new Set(records.map((record, index) => googleEmail(record.google_account, index)))];
  return { emails, duplicatesSkipped: records.length - emails.length };
}
