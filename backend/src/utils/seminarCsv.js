import { parse } from "csv-parse/sync";

import { HttpError } from "./http.js";

// Always a 400: the uploaded list or a row in it is invalid.
export class CsvError extends HttpError { constructor(message) { super(400, message); } }
export const MAX_CSV_BYTES = 1024 * 1024;

function readRows(csv, required, optional = []) {
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
        const repeated = optional.find(name => headers.filter(header => header === name).length > 1);
        if (repeated) throw new CsvError(`CSV must not repeat the ${repeated} column.`);
        return headers.map(header => required.includes(header) || optional.includes(header) ? header : false);
      },
    });
  } catch (err) {
    if (err instanceof CsvError) throw err;
    throw new CsvError("Could not read the CSV. Check quotes and the number of columns in each row.");
  }
  if (!records.length) throw new CsvError("The CSV contains no student records.");
  return records;
}

export function googleEmail(value, where) {
  const email = typeof value === "string" ? value.trim().toLowerCase() : "";
  if (email.length > 255 || /[\u0000-\u001f\u007f]/.test(email) || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
    throw new CsvError(`${where}: enter a valid Google account email.`);
  }
  return email;
}

// Validates and de-duplicates student rows ({ full_name, program, google_account }) from a CSV or a JSON request.
// `label` names a row in errors ("CSV record", "Row").
// Spaces, dashes, dots and parentheses are dropped, so "0917 123 4567" is stored as 09171234567.
export const cleanContactNumber = value => typeof value === "string" ? value.replace(/[\s().-]/g, "") : "";
export const isContactNumber = value => /^\d{11}$/.test(value);

export function readStudentRows(rows, label = "CSV record") {
  const students = new Map();
  for (const [index, row] of rows.entries()) {
    const where = `${label} ${index + 1}`;
    const student = {
      full_name: typeof row?.full_name === "string" ? row.full_name.trim() : "",
      program: typeof row?.program === "string" ? row.program.trim() : "",
      google_account: googleEmail(row?.google_account, where),
    };
    if (Object.values(student).some(value => !value || value.length > 255 || /[\u0000-\u001f\u007f]/.test(value))) {
      throw new CsvError(`${where}: name, program, and Google email must each contain 1–255 characters without line breaks or control characters.`);
    }
    const contact = cleanContactNumber(row?.contact_number);
    if (!isContactNumber(contact)) throw new CsvError(`${where}: enter an 11-digit contact number, for example 09171234567.`);
    student.contact_number = contact;
    const previous = students.get(student.google_account);
    if (previous && (previous.full_name !== student.full_name || previous.program !== student.program ||
        previous.contact_number !== student.contact_number)) {
      throw new CsvError(`${where}: a repeated email has conflicting names, programs or contact numbers. Correct it before importing.`);
    }
    students.set(student.google_account, student);
  }
  return { students: [...students.values()], duplicatesSkipped: rows.length - students.size };
}

const NAME_COLUMNS = ["full_name", "first_name", "last_name"];

// The name comes from full_name, or from first_name and last_name joined as "First Last" (one or the other, not both).
// A row missing either part gets an empty name, which readStudentRows rejects.
function withFullName(records) {
  const columns = NAME_COLUMNS.filter(name => name in records[0]);
  if (columns.length === 1 && columns[0] === "full_name") return records;
  if (columns.length !== 2 || columns.includes("full_name")) {
    throw new CsvError("CSV must contain either full_name, or first_name and last_name.");
  }
  return records.map(({ first_name: first, last_name: last, ...record }) =>
    ({ ...record, full_name: first && last ? `${first} ${last}` : "" }));
}

export function readRegistrationCsv(csv) {
  return readStudentRows(withFullName(readRows(csv, ["program", "google_account", "contact_number"], NAME_COLUMNS)));
}

// Optional name/program are only prefill hints for registering an unknown attendee; faculty review them first.
const hint = value => typeof value === "string" ? value.replace(/[\u0000-\u001f\u007f]/g, " ").trim().replace(/ +/g, " ").slice(0, 255) : "";

export function readAttendanceCsv(csv) {
  const records = readRows(csv, ["google_account"], [...NAME_COLUMNS, "program"]);
  const hints = new Map();
  records.forEach((record, index) => {
    const email = googleEmail(record.google_account, `CSV record ${index + 1}`);
    const fullName = hint(record.full_name) || hint(`${record.first_name ?? ""} ${record.last_name ?? ""}`);
    if (!hints.has(email)) hints.set(email, { fullName, program: hint(record.program) });
  });
  return { emails: [...hints.keys()], hints, duplicatesSkipped: records.length - hints.size };
}
