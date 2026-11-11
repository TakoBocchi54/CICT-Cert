import assert from "node:assert/strict";
import test from "node:test";
import { readRegistrationCsv, readAttendanceCsv, CsvError, MAX_CSV_BYTES } from "./seminarCsv.js";

const header = "full_name,section,program,google_account";
test("registration CSV handles BOM, quoted names, CRLF and ignored columns", () => {
  const result = readRegistrationCsv('\uFEFF' + header + ',notes\r\n"Reyes, ""Ana""",CS 3-1,BSCS," ANA@GMAIL.COM ","Line one\r\nLine two"\r\n');
  assert.deepEqual(result, { students: [{ full_name: 'Reyes, "Ana"', program: "BSCS", google_account: "ana@gmail.com" }], duplicatesSkipped: 0 });
});
test("registration CSV normalizes headers and email, retaining plus tags and Workspace domains", () => {
  const result = readRegistrationCsv(" FULL_NAME ,PROGRAM, GOOGLE_ACCOUNT \nJuan,BSCS,Juan+Seminar@ub.edu.ph");
  assert.equal(result.students[0].google_account, "juan+seminar@ub.edu.ph");
});
test("identical duplicate emails are skipped, conflicting profiles are rejected", () => {
  const duplicate = header + "\nJuan,A,BSCS,juan@gmail.com\nJuan,B,BSCS,JUAN@GMAIL.COM";
  assert.equal(readRegistrationCsv(duplicate).duplicatesSkipped, 1);
  assert.throws(() => readRegistrationCsv(duplicate.replace("Juan,B", "Pedro,B")), /conflicting/);
});
test("registration CSV rejects malformed, empty, oversized or invalid input", () => {
  for (const csv of [undefined, {}, "", header, "a,b,c\nJuan,BSCS,email", "full_name,program,google_account,google_account\nJuan,BSCS,a@gmail.com,b@gmail.com",
    header + '\n"Unclosed,A,BSCS,juan@gmail.com', header + "\nJuan,A,BSCS", header + "\nJuan,A,BSCS,invalid-email",
    header + "\n ,A,BSCS,juan@gmail.com", header + "\nJuan,A, ,juan@gmail.com", header + "\n" + "x".repeat(256) + ",A,BSCS,juan@gmail.com",
    header + '\n"Juan\nCruz",A,BSCS,juan@gmail.com', "x".repeat(MAX_CSV_BYTES + 1)]) {
    assert.throws(() => readRegistrationCsv(csv), CsvError);
  }
});

test("attendance CSV matches only normalized Google emails; name and program are kept as hints only", () => {
  const csv = '\uFEFFfull_name,section,program,student_id, GOOGLE_ACCOUNT \r\nWrong Name,CS 3-1,Wrong Program,00123," JUAN+Seminar@ub.edu.ph "\r\nDifferent Name,Other,Other,999,juan+seminar@ub.edu.ph';
  const result = readAttendanceCsv(csv);
  assert.deepEqual(result.emails, ["juan+seminar@ub.edu.ph"]);
  assert.equal(result.duplicatesSkipped, 1);
  assert.deepEqual(result.hints.get("juan+seminar@ub.edu.ph"), { fullName: "Wrong Name", program: "Wrong Program" });
  const bare = readAttendanceCsv("google_account\nana@gmail.com");
  assert.deepEqual([bare.emails, bare.duplicatesSkipped, bare.hints.get("ana@gmail.com")], [["ana@gmail.com"], 0, { fullName: "", program: "" }]);
});

test("attendance CSV rejects empty lists, missing or repeated email headers and invalid emails", () => {
  for (const csv of ["google_account", "full_name,student_id\nJuan,123", "google_account,google_account\na@gmail.com,b@gmail.com", "full_name,full_name,google_account\nA,B,a@gmail.com", "google_account\nnot-an-email", 'google_account\n" "', "x".repeat(MAX_CSV_BYTES + 1)]) {
    assert.throws(() => readAttendanceCsv(csv), CsvError);
  }
});
