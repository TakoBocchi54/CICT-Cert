export class StudentError extends Error {
  constructor(status, message) { super(message); this.status = status; }
}

// Creates student accounts for validated rows ({ full_name, program, google_account }) inside the caller's
// transaction. Existing student accounts are reused unchanged (name, program and wallet kept). Faculty emails and
// incomplete student profiles reject the whole batch. Returns the student IDs by email and how many were new.
export async function registerStudents(client, students) {
  const data = JSON.stringify(students);
  const emails = students.map(student => student.google_account);
  // Stable email order avoids conflicting insert locks between concurrent imports.
  const createdUsers = await client.query(
    `INSERT INTO users ("email", "role")
     SELECT google_account, 'STUDENT' FROM jsonb_to_recordset($1::jsonb) AS csv(google_account text)
     ORDER BY google_account ON CONFLICT ("email") DO NOTHING RETURNING "userID"`, [data],
  );
  const accounts = await client.query(
    `SELECT u."userID", u."role", s."studentID" FROM users u
     LEFT JOIN student s ON s."userID" = u."userID" WHERE u."email" = ANY($1::text[])`, [emails],
  );
  const newUserIDs = new Set(createdUsers.rows.map(user => user.userID));
  if (accounts.rows.some(account => account.role !== "STUDENT" || (!account.studentID && !newUserIDs.has(account.userID)))) {
    throw new StudentError(409, "An email belongs to a faculty account or an incomplete student profile. No students were registered; contact CICT to resolve the account.");
  }
  const profiles = await client.query(
    `INSERT INTO student ("userID", "fullName", "program")
     SELECT u."userID", csv.full_name, csv.program
     FROM jsonb_to_recordset($1::jsonb) AS csv(full_name text, program text, google_account text)
     JOIN users u ON u."email" = csv.google_account
     ORDER BY u."userID" ON CONFLICT ("userID") DO NOTHING`, [data],
  );
  const ids = await client.query(
    `SELECT u."email", s."studentID" FROM student s JOIN users u ON u."userID" = s."userID"
     WHERE u."email" = ANY($1::text[]) ORDER BY s."studentID"`, [emails],
  );
  return { students: ids.rows, created: profiles.rowCount };
}
