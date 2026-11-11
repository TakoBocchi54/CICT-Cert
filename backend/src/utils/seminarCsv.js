import { parse } from "csv-parse/sync";

export class CsvError extends Error {}
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
    const previous = students.get(student.google_account);
    if (previous && (previous.full_name !== student.full_name || previous.program !== student.program)) {
      throw new CsvError(`${where}: a repeated email has conflicting names or programs. Correct it before importing.`);
    }
    students.set(student.google_account, student);
  }
  return { students: [...students.values()], duplicatesSkipped: rows.length - students.size };
}

export function readRegistrationCsv(csv) {
  return readStudentRows(readRows(csv, ["full_name", "program", "google_account"]));
}

// Optional full_name/program are only prefill hints for registering an unknown attendee; faculty review them first.
const hint = value => typeof value === "string" ? value.replace(/[\u0000-\u001f\u007f]/g, " ").trim().slice(0, 255) : "";

export function readAttendanceCsv(csv) {
  const records = readRows(csv, ["google_account"], ["full_name", "program"]);
  const hints = new Map();
  records.forEach((record, index) => {
    const email = googleEmail(record.google_account, `CSV record ${index + 1}`);
    if (!hints.has(email)) hints.set(email, { fullName: hint(record.full_name), program: hint(record.program) });
  });
  return { emails: [...hints.keys()], hints, duplicatesSkipped: records.length - hints.size };
}
