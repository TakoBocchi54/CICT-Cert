import express, { Router } from "express";
import { pool } from "../db/pool.js";
import { requireFaculty, requireActiveFaculty } from "../middleware/requireFaculty.js";
import {
  TemplateError, TEMPLATE_IMAGE_BYTES, SIGNATURE_IMAGE_BYTES, MAX_SIGNATURES, defaultFields, readFields,
  readSignatureImage, readTemplateImage, readTemplateName, templateJson,
} from "../utils/certificateTemplate.js";

const router = Router();
const images = ["image/png", "image/jpeg"];
const templateUpload = express.raw({ type: images, limit: TEMPLATE_IMAGE_BYTES });
const signatureUpload = express.raw({ type: images, limit: SIGNATURE_IMAGE_BYTES });

for (const name of ["templateID", "signatureID"]) {
  router.param(name, (req, res, next, value) => {
    if (!/^[1-9]\d{0,18}$/.test(value) || BigInt(value) > 9223372036854775807n) return res.status(400).json({ error: "Invalid ID." });
    next();
  });
}

// Public: certificates render these on the student pages, in PDFs and on the public verifier.
// Only PNG/JPEG bytes validated at upload are stored, and nosniff keeps browsers from treating them as anything else.
async function sendImage(res, query, params) {
  const { rows } = await pool.query(query, params);
  if (!rows.length) return res.status(404).json({ error: "Image not found." });
  res.set({ "Content-Type": rows[0].imageType, "X-Content-Type-Options": "nosniff", "Cache-Control": "public, max-age=31536000, immutable" });
  res.send(rows[0].image);
}
router.get("/certificate-templates/:templateID/image", (req, res) => sendImage(res,
  `SELECT "image", "imageType" FROM certificate_template WHERE "templateID" = $1`, [req.params.templateID]));
router.get("/certificate-templates/:templateID/signatures/:signatureID", (req, res) => sendImage(res,
  `SELECT "image", "imageType" FROM certificate_template_signature WHERE "templateID" = $1 AND "signatureID" = $2`,
  [req.params.templateID, req.params.signatureID]));

router.use("/faculty/certificate-templates", requireFaculty, requireActiveFaculty);

async function listTemplates(db, facultyID, templateID = null) {
  const [{ rows }, faculty] = await Promise.all([db.query(
    `SELECT ${templateJson("t")} AS "template", t."name", t."createdBy"::text AS "createdBy",
            f."firstName" || ' ' || f."lastName" AS "createdByName",
            (SELECT count(*)::int FROM seminar s WHERE s."templateID" = t."templateID") AS "seminarCount",
            EXISTS (SELECT 1 FROM certificate c JOIN seminar s ON s."seminarID" = c."seminarID" WHERE s."templateID" = t."templateID") AS "locked"
     FROM certificate_template t JOIN cict_faculty f ON f."facultyID" = t."createdBy"
     WHERE $1::bigint IS NULL OR t."templateID" = $1 ORDER BY t."createdAt" DESC, t."templateID" DESC`, [templateID]),
  db.query(`SELECT "canIssue" FROM cict_faculty WHERE "facultyID" = $1`, [facultyID])]);
  return rows.map(({ template, ...row }) => ({ ...template, ...row,
    canEdit: !row.locked && (row.createdBy === String(facultyID) || faculty.rows[0]?.canIssue === true) }));
}

router.get("/faculty/certificate-templates", async (req, res) => {
  res.json(await listTemplates(pool, req.faculty.facultyID));
});

router.post("/faculty/certificate-templates", templateUpload, async (req, res) => {
  const name = readTemplateName(req.query.name);
  const image = readTemplateImage(req.body);
  const { rows } = await pool.query(
    `INSERT INTO certificate_template ("name", "image", "imageType", "imageWidth", "imageHeight", "fields", "createdBy")
     VALUES ($1, $2, $3, $4, $5, $6, $7) RETURNING "templateID"`,
    [name, req.body, image.type, image.width, image.height, defaultFields(), req.faculty.facultyID]);
  res.status(201).json((await listTemplates(pool, req.faculty.facultyID, rows[0].templateID))[0]);
});

// Templates change only while no certificate uses them (an issued certificate must always render the same), and only
// by their creator or a canIssue faculty. Locking the seminars that use the template serializes with certificate
// preparation, which locks its seminar row FOR UPDATE.
async function changeTemplate(req, res, change) {
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    const { rows } = await client.query(
      `SELECT t."createdBy"::text AS "createdBy", f."canIssue" FROM certificate_template t, cict_faculty f
       WHERE t."templateID" = $1 AND f."facultyID" = $2 FOR UPDATE OF t`, [req.params.templateID, req.faculty.facultyID]);
    if (!rows.length) throw new TemplateError(404, "Template not found.");
    if (rows[0].createdBy !== String(req.faculty.facultyID) && !rows[0].canIssue) {
      throw new TemplateError(403, "Only the faculty member who created this template, or one who can issue certificates, can change it.");
    }
    await client.query(`SELECT 1 FROM seminar WHERE "templateID" = $1 FOR SHARE`, [req.params.templateID]);
    const used = await client.query(
      `SELECT 1 FROM certificate c JOIN seminar s ON s."seminarID" = c."seminarID" WHERE s."templateID" = $1 LIMIT 1`, [req.params.templateID]);
    if (used.rowCount) throw new TemplateError(409, "Certificates already use this template, so it can no longer be changed or deleted.");
    const result = await change(client);
    await client.query("COMMIT");
    if (result === undefined) return res.status(204).end();
    res.status(result.status ?? 200).json(result.body ?? (await listTemplates(pool, req.faculty.facultyID, req.params.templateID))[0]);
  } catch (err) {
    await client.query("ROLLBACK");
    throw err;
  } finally { client.release(); }
}

router.patch("/faculty/certificate-templates/:templateID", (req, res) => changeTemplate(req, res, async client => {
  const name = readTemplateName(req.body?.name);
  const signatureIDs = (await client.query(
    `SELECT "signatureID"::text AS id FROM certificate_template_signature WHERE "templateID" = $1`, [req.params.templateID])).rows.map(row => row.id);
  const fields = readFields(req.body?.fields, signatureIDs);
  await client.query(`UPDATE certificate_template SET "name" = $2, "fields" = $3, "updatedAt" = now() WHERE "templateID" = $1`,
    [req.params.templateID, name, fields]);
  return {};
}));

router.put("/faculty/certificate-templates/:templateID/image", templateUpload, (req, res) => changeTemplate(req, res, async client => {
  const image = readTemplateImage(req.body);
  await client.query(
    `UPDATE certificate_template SET "image" = $2, "imageType" = $3, "imageWidth" = $4, "imageHeight" = $5, "updatedAt" = now()
     WHERE "templateID" = $1`, [req.params.templateID, req.body, image.type, image.width, image.height]);
  return {};
}));

// Seminars that chose this template fall back to the built-in design (ON DELETE SET NULL).
router.delete("/faculty/certificate-templates/:templateID", (req, res) => changeTemplate(req, res, async client => {
  await client.query(`DELETE FROM certificate_template WHERE "templateID" = $1`, [req.params.templateID]);
}));

router.post("/faculty/certificate-templates/:templateID/signatures", signatureUpload, (req, res) => changeTemplate(req, res, async client => {
  const image = readSignatureImage(req.body);
  const count = (await client.query(
    `SELECT count(*)::int AS n FROM certificate_template_signature WHERE "templateID" = $1`, [req.params.templateID])).rows[0].n;
  if (count >= MAX_SIGNATURES) throw new TemplateError(409, `A template can have up to ${MAX_SIGNATURES} signatures. Remove one first.`);
  const { rows } = await client.query(
    `INSERT INTO certificate_template_signature ("templateID", "image", "imageType", "imageWidth", "imageHeight")
     VALUES ($1, $2, $3, $4, $5) RETURNING "signatureID"::text AS "signatureID"`,
    [req.params.templateID, req.body, image.type, image.width, image.height]);
  const { signatureID } = rows[0];
  return { status: 201, body: { signatureID, imageUrl: `/api/certificate-templates/${req.params.templateID}/signatures/${signatureID}` } };
}));

router.delete("/faculty/certificate-templates/:templateID/signatures/:signatureID", (req, res) => changeTemplate(req, res, async client => {
  const removed = await client.query(
    `DELETE FROM certificate_template_signature WHERE "templateID" = $1 AND "signatureID" = $2`, [req.params.templateID, req.params.signatureID]);
  if (!removed.rowCount) throw new TemplateError(404, "Signature not found.");
  // Drop its placement too, so saved fields never point at a missing image.
  await client.query(
    `UPDATE certificate_template SET "updatedAt" = now(), "fields" = jsonb_set("fields", '{signatures}', COALESCE(
       (SELECT jsonb_agg(s) FROM jsonb_array_elements("fields"->'signatures') s WHERE s->>'signatureID' <> $2), '[]'::jsonb))
     WHERE "templateID" = $1`, [req.params.templateID, req.params.signatureID]);
}));

router.use((err, req, res, next) => {
  if (err instanceof TemplateError) return res.status(err.status).json({ error: err.message });
  if (err.type === "entity.too.large") {
    const mb = (req.path.includes("/signatures") ? SIGNATURE_IMAGE_BYTES : TEMPLATE_IMAGE_BYTES) / 1024 / 1024;
    return res.status(413).json({ error: `The image is larger than ${mb} MB. Export it smaller and try again.` });
  }
  next(err);
});

export default router;
