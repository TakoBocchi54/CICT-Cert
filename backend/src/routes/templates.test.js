import "dotenv/config";
import test from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { readFile } from "node:fs/promises";
import express from "express";
import cookieParser from "cookie-parser";
import pg from "pg";
import { SignJWT } from "jose";

const local = process.env.DATABASE_URL && ["localhost", "127.0.0.1", "[::1]"].includes(new URL(process.env.DATABASE_URL).hostname);
process.env.SESSION_SECRET = "template-route-test-secret-only";
const { default: router } = await import("./templates.js");
const { pool } = await import("../db/pool.js");
const { certificateTemplateSql, defaultFields } = await import("../utils/certificateTemplate.js");

// Only the header is read, so a PNG signature + IHDR is enough to stand in for an image.
function png(width, height, size = 33) {
  const buffer = Buffer.alloc(size);
  Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 13]).copy(buffer);
  buffer.write("IHDR", 12, "latin1");
  buffer.writeUInt32BE(width, 16);
  buffer.writeUInt32BE(height, 20);
  return buffer;
}

test("certificate template endpoints with PostgreSQL", { skip: !local && "Requires local PostgreSQL; never runs against production" }, async t => {
  const schema = "cict_template_test_" + randomUUID().replaceAll("-", "");
  const admin = new pg.Client({ connectionString: process.env.DATABASE_URL });
  await admin.connect();
  await admin.query(`CREATE SCHEMA "${schema}"`);
  const db = new pg.Pool({ connectionString: process.env.DATABASE_URL, options: "-c search_path=" + schema });
  const originalQuery = pool.query;
  const originalConnect = pool.connect;
  pool.query = db.query.bind(db);
  pool.connect = db.connect.bind(db);
  let server;
  t.after(async () => {
    if (server) await new Promise(resolve => server.close(resolve));
    pool.query = originalQuery;
    pool.connect = originalConnect;
    await db.end();
    // This generated test schema is the only deletion target.
    await admin.query(`DROP SCHEMA "${schema}" CASCADE`);
    await admin.end();
    await pool.end();
  });
  const client = await db.connect();
  try {
    await client.query(await readFile(new URL("../../sql/schema.sql", import.meta.url), "utf8"));
  } finally { client.release(); }
  await db.query(`
    INSERT INTO users ("email", "role", "passwordHash") VALUES
      ('issuer@example.test', 'FACULTY', 'x'), ('maker@example.test', 'FACULTY', 'x'), ('other@example.test', 'FACULTY', 'x'), ('s@gmail.com', 'STUDENT', NULL);
    INSERT INTO cict_faculty ("userID", "firstName", "lastName", "canIssue") VALUES (1, 'Ana', 'Reyes', true), (2, 'Pedro', 'Cruz', false), (3, 'Lia', 'Santos', false);
    INSERT INTO student ("userID", "fullName", "program") VALUES (4, 'Student One', 'BSIT');
    INSERT INTO issuer_wallet ("issuerWalletAddress", "label", "network") VALUES ('0x2222222222222222222222222222222222222222', 'Test', 'amoy');`);
  const app = express();
  app.use(express.json({ limit: "2mb" }), cookieParser());
  app.use("/api", router);
  server = app.listen(0, "127.0.0.1");
  await new Promise(resolve => server.once("listening", resolve));
  const origin = "http://127.0.0.1:" + server.address().port;
  const key = new TextEncoder().encode(process.env.SESSION_SECRET);
  const cookie = async (facultyID, userID = facultyID) => "cict_session=" + await new SignJWT({ role: "FACULTY", userID, facultyID })
    .setProtectedHeader({ alg: "HS256" }).setIssuedAt().setExpirationTime("5m").sign(key);
  const [issuer, maker, other] = await Promise.all([cookie("1"), cookie("2"), cookie("3")]);
  async function request(method, path, { body, image, type = "image/png", session = maker } = {}) {
    const response = await fetch(origin + (path.startsWith("/api/") ? "" : "/api") + path, { method,
      headers: { ...(session ? { Cookie: session } : {}), "Content-Type": image ? type : "application/json" },
      body: image ?? (body === undefined ? undefined : JSON.stringify(body)) });
    const isJson = response.headers.get("content-type")?.includes("json");
    return { status: response.status, headers: response.headers, data: isJson ? await response.json() : Buffer.from(await response.arrayBuffer()) };
  }

  let template;
  await t.test("uploads validate type, paper size and file size", async () => {
    assert.equal((await request("GET", "/faculty/certificate-templates", { session: "" })).status, 401);
    assert.equal((await request("POST", "/faculty/certificate-templates?name=Gold", { image: png(1754, 1240), session: "" })).status, 401);
    const rejected = [
      [{ body: { image: "x" } }, /PNG or JPG/],
      [{ image: Buffer.from("<svg></svg>"), type: "image/png" }, /PNG or JPG/],
      [{ image: png(1754, 1240), type: "image/svg+xml" }, /PNG or JPG/],
      [{ image: png(2000, 1000) }, /supported paper size/],
      [{ image: png(842, 595) }, /too small/],
    ];
    for (const [options, message] of rejected) {
      const response = await request("POST", "/faculty/certificate-templates?name=Gold", options);
      assert.equal(response.status, 400);
      assert.match(response.data.error, message);
    }
    assert.match((await request("POST", "/faculty/certificate-templates?name=%20", { image: png(1754, 1240) })).data.error, /name is required/);
    const tooLarge = await request("POST", "/faculty/certificate-templates?name=Big", { image: png(1754, 1240, 5 * 1024 * 1024 + 1) });
    assert.equal(tooLarge.status, 413);
    assert.match(tooLarge.data.error, /larger than 5 MB/);

    const created = await request("POST", "/faculty/certificate-templates?name=" + encodeURIComponent(" Gold border "), { image: png(1754, 1240) });
    assert.equal(created.status, 201);
    template = created.data;
    assert.deepEqual([template.name, template.width, template.height, template.locked, template.canEdit, template.seminarCount],
      ["Gold border", 1754, 1240, false, true, 0]);
    assert.deepEqual(template.fields, defaultFields());
    assert.deepEqual(template.signatures, []);
    assert.match(template.imageUrl, new RegExp(`^/api/certificate-templates/${template.templateID}/image\\?v=\\d+$`));

    const image = await request("GET", template.imageUrl, { session: "" });
    assert.equal(image.status, 200);
    assert.equal(image.headers.get("content-type"), "image/png");
    assert.equal(image.headers.get("x-content-type-options"), "nosniff");
    assert.ok(image.data.equals(png(1754, 1240)));
    assert.equal((await request("GET", "/certificate-templates/999/image", { session: "" })).status, 404);
  });

  await t.test("the creator or a canIssue faculty edits; others can only view", async () => {
    const path = "/faculty/certificate-templates/" + template.templateID;
    const fields = defaultFields();
    fields.text.seminarDate.show = false;
    assert.equal((await request("PATCH", path, { body: { name: "Gold", fields }, session: other })).status, 403);
    assert.equal((await request("GET", "/faculty/certificate-templates", { session: other })).data[0].canEdit, false);
    assert.equal((await request("PATCH", path, { body: { name: "Gold", fields: { ...fields, qr: null } } })).status, 400);
    const saved = await request("PATCH", path, { body: { name: "Gold", fields } });
    assert.equal(saved.status, 200);
    assert.equal(saved.data.fields.text.seminarDate.show, false);
    assert.equal((await request("PATCH", path, { body: { name: "Gold (by issuer)", fields }, session: issuer })).status, 200);
    assert.equal((await request("PATCH", "/faculty/certificate-templates/999", { body: { name: "x", fields } })).status, 404);

    const replaced = await request("PUT", path + "/image", { image: png(1275, 1650) });
    assert.equal(replaced.status, 200);
    assert.deepEqual([replaced.data.width, replaced.data.height], [1275, 1650]);
    assert.notEqual(replaced.data.imageUrl, template.imageUrl);
    assert.equal((await request("PUT", path + "/image", { image: png(1000, 1000) })).status, 400);
    template = replaced.data;
  });

  await t.test("signatures: up to 3, placed by ID, removed together with their placement", async () => {
    const path = "/faculty/certificate-templates/" + template.templateID;
    const ids = [];
    for (let i = 0; i < 3; i++) {
      const added = await request("POST", path + "/signatures", { image: png(600, 200) });
      assert.equal(added.status, 201);
      ids.push(added.data.signatureID);
    }
    const fourth = await request("POST", path + "/signatures", { image: png(600, 200) });
    assert.equal(fourth.status, 409);
    assert.equal((await request("POST", path + "/signatures", { image: png(600, 200, 1024 * 1024 + 1) })).status, 413);
    const signature = await request("GET", `/certificate-templates/${template.templateID}/signatures/${ids[0]}`, { session: "" });
    assert.equal(signature.status, 200);
    assert.equal(signature.headers.get("content-type"), "image/png");

    const place = id => ({ signatureID: id, x: 30, y: 85, width: 18, line: true, name: "Dr. Maria Santos", title: "Dean, CICT", size: 1.4, font: "sans", color: "#16231d" });
    const fields = { ...template.fields, signatures: [place(ids[0]), place(ids[1])] };
    assert.equal((await request("PATCH", path, { body: { name: "Gold", fields: { ...fields, signatures: [place("999")] } } })).status, 400);
    assert.equal((await request("PATCH", path, { body: { name: "Gold", fields } })).status, 200);
    assert.equal((await request("DELETE", `${path}/signatures/${ids[0]}`)).status, 204);
    const [listed] = (await request("GET", "/faculty/certificate-templates")).data;
    assert.deepEqual(listed.fields.signatures.map(s => s.signatureID), [ids[1]]);
    assert.deepEqual(listed.signatures.map(s => s.signatureID), [ids[1], ids[2]]);
    assert.equal((await request("DELETE", `${path}/signatures/${ids[0]}`)).status, 404);
  });

  await t.test("a template is locked once a seminar using it has certificates", async () => {
    const path = "/faculty/certificate-templates/" + template.templateID;
    await db.query(`INSERT INTO seminar ("seminarTitle", "seminarDate", "createdBy", "templateID") VALUES ('Web Security', '2026-11-20', 2, $1)`, [template.templateID]);
    await db.query(`INSERT INTO seminar_registration ("seminarID", "studentID", attended) VALUES (1, 1, true);
      INSERT INTO certificate ("studentID", "issuerWalletID", "recipientName", "seminarTitle", "seminarDate", "seminarID")
      VALUES (1, 1, 'Student One', 'Web Security', '2026-11-20', 1)`);
    const [listed] = (await request("GET", "/faculty/certificate-templates")).data;
    assert.deepEqual([listed.locked, listed.canEdit, listed.seminarCount], [true, false, 1]);
    for (const [method, suffix, options] of [["PATCH", "", { body: { name: "x", fields: listed.fields } }], ["PUT", "/image", { image: png(1754, 1240) }],
      ["DELETE", ""], ["POST", "/signatures", { image: png(600, 200) }], ["DELETE", "/signatures/" + listed.signatures[0].signatureID]]) {
      const response = await request(method, path + suffix, { ...options, session: issuer });
      assert.equal(response.status, 409, method + suffix);
      assert.match(response.data.error, /Certificates already use this template/);
    }

    // Certificates render from their seminar's template.
    const { rows } = await db.query(`SELECT ${certificateTemplateSql("c")} FROM certificate c`);
    assert.deepEqual([rows[0].template.templateID, rows[0].template.width, rows[0].template.imageUrl, rows[0].template.signatures.length],
      [template.templateID, 1275, listed.imageUrl, 2]);
  });

  await t.test("deleting an unused template moves its seminars back to the built-in design", async () => {
    const created = (await request("POST", "/faculty/certificate-templates?name=Spare", { image: png(3300, 2550) })).data;
    await db.query(`INSERT INTO seminar ("seminarTitle", "seminarDate", "createdBy", "templateID") VALUES ('Cloud', '2026-11-21', 2, $1)`, [created.templateID]);
    assert.equal((await request("DELETE", "/faculty/certificate-templates/" + created.templateID, { session: other })).status, 403);
    assert.equal((await request("DELETE", "/faculty/certificate-templates/" + created.templateID)).status, 204);
    assert.equal((await db.query(`SELECT "templateID" FROM seminar WHERE "seminarTitle" = 'Cloud'`)).rows[0].templateID, null);
    assert.equal((await request("GET", created.imageUrl, { session: "" })).status, 404);
  });
});
