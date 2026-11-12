// Certificate templates: uploaded background + placed fields. Rendering only; the certificate hash never includes them.

export const TEMPLATE_IMAGE_BYTES = 5 * 1024 * 1024;
export const SIGNATURE_IMAGE_BYTES = 1024 * 1024;
export const MIN_TEMPLATE_WIDTH = 1000;
export const MAX_SIGNATURES = 3;
export const TEXT_FIELDS = ["recipientName", "seminarTitle", "seminarDate", "certificateNo"];
export const FONTS = ["serif", "sans", "script", "mono"];
const PAPERS = [{ name: "A4", mm: [297, 210] }, { name: "Letter", mm: [279.4, 215.9] }];
export const PAPER_HINT = "A4 (e.g. 3508×2480 or 1754×1240 px) or US Letter (e.g. 3300×2550 or 1650×1275 px), landscape or portrait";

export class TemplateError extends Error {
  constructor(status, message) { super(message); this.status = status; }
}

// Type and pixel size from the file header: PNG IHDR or the JPEG start-of-frame marker. Anything else returns null.
export function imageInfo(buffer) {
  if (!Buffer.isBuffer(buffer) || buffer.length < 24) return null;
  if (buffer.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])) && buffer.toString("latin1", 12, 16) === "IHDR") {
    return { type: "image/png", width: buffer.readUInt32BE(16), height: buffer.readUInt32BE(20) };
  }
  if (buffer[0] !== 0xff || buffer[1] !== 0xd8) return null;
  let i = 2;
  while (i + 4 <= buffer.length) {
    if (buffer[i] !== 0xff) return null;
    const marker = buffer[i + 1];
    if (marker === 0xff) { i += 1; continue; } // fill byte
    if (marker === 0x01 || (marker >= 0xd0 && marker <= 0xd9)) { i += 2; continue; } // markers without a length
    const length = buffer.readUInt16BE(i + 2);
    if (length < 2) return null;
    const startOfFrame = marker >= 0xc0 && marker <= 0xcf && ![0xc4, 0xc8, 0xcc].includes(marker);
    if (startOfFrame) {
      if (i + 9 > buffer.length) return null;
      return { type: "image/jpeg", height: buffer.readUInt16BE(i + 5), width: buffer.readUInt16BE(i + 7) };
    }
    i += 2 + length;
  }
  return null;
}

// Paper from the image proportions (±2%), so the background is never cropped or stretched. mm is [width, height].
export function paperSize(width, height) {
  for (const paper of PAPERS) {
    for (const [orientation, mm] of [["landscape", paper.mm], ["portrait", [paper.mm[1], paper.mm[0]]]]) {
      if (Math.abs(width / height / (mm[0] / mm[1]) - 1) <= 0.02) return { name: paper.name, orientation, mm };
    }
  }
  return null;
}

export function readTemplateImage(body) {
  const info = imageInfo(body);
  if (!info) throw new TemplateError(400, "Upload a PNG or JPG image.");
  if (info.width < MIN_TEMPLATE_WIDTH && info.height < MIN_TEMPLATE_WIDTH) {
    throw new TemplateError(400, `The image is too small to print clearly (${info.width}×${info.height} px). Use at least ${MIN_TEMPLATE_WIDTH} px on the long side.`);
  }
  if (!paperSize(info.width, info.height)) {
    throw new TemplateError(400, `The image is ${info.width}×${info.height} px, which isn't a supported paper size. Use ${PAPER_HINT}.`);
  }
  return info;
}

export function readSignatureImage(body) {
  const info = imageInfo(body);
  if (!info) throw new TemplateError(400, "Upload the signature as a PNG or JPG image.");
  return info;
}

export function readTemplateName(value) {
  const name = typeof value === "string" ? value.trim() : "";
  if (!name || name.length > 100) throw new TemplateError(400, "Template name is required (up to 100 characters).");
  return name;
}

const DEFAULT_TEXT = {
  recipientName: { show: true, x: 50, y: 44, size: 5, font: "serif", color: "#16231d", align: "center", bold: false, maxWidth: 80 },
  seminarTitle: { show: true, x: 50, y: 60, size: 3, font: "serif", color: "#16231d", align: "center", bold: true, maxWidth: 70 },
  seminarDate: { show: true, x: 50, y: 68, size: 1.6, font: "sans", color: "#3a4a41", align: "center", bold: false, maxWidth: 60 },
  certificateNo: { show: true, x: 94, y: 6, size: 1.3, font: "mono", color: "#3a4a41", align: "right", bold: false, maxWidth: 30 },
};
export const defaultFields = () => ({ text: structuredClone(DEFAULT_TEXT), qr: { x: 88, y: 80, size: 12 }, signatures: [] });

const number = (value, min, max, label) => {
  if (typeof value !== "number" || !Number.isFinite(value)) throw new TemplateError(400, `${label} must be a number.`);
  return Math.round(Math.min(max, Math.max(min, value)) * 100) / 100;
};
const color = (value, label) => {
  if (typeof value !== "string" || !/^#[0-9a-f]{6}$/i.test(value)) throw new TemplateError(400, `${label} must be a color like #16231d.`);
  return value.toLowerCase();
};
const font = (value, label) => {
  if (!FONTS.includes(value)) throw new TemplateError(400, `${label} must be one of: ${FONTS.join(", ")}.`);
  return value;
};
const caption = (value, label) => {
  if (value == null) return "";
  if (typeof value !== "string" || value.trim().length > 100) throw new TemplateError(400, `${label} must be text up to 100 characters.`);
  return value.trim();
};

// Whitelists and normalizes the placed fields. Name and QR are always shown; signatures must belong to this template.
export function readFields(input, signatureIDs) {
  if (!input || typeof input !== "object") throw new TemplateError(400, "Template fields are required.");
  const text = {};
  for (const key of TEXT_FIELDS) {
    const field = input.text?.[key];
    if (!field || typeof field !== "object") throw new TemplateError(400, `Missing the ${key} field.`);
    if (!["left", "center", "right"].includes(field.align)) throw new TemplateError(400, `${key} alignment must be left, center or right.`);
    text[key] = {
      show: key === "recipientName" ? true : field.show === true,
      x: number(field.x, 0, 100, `${key} X`), y: number(field.y, 0, 100, `${key} Y`),
      size: number(field.size, 0.5, 15, `${key} size`), font: font(field.font, `${key} font`),
      color: color(field.color, `${key} color`), align: field.align, bold: field.bold === true,
      maxWidth: number(field.maxWidth, 5, 100, `${key} width`),
    };
  }
  const qr = input.qr;
  if (!qr || typeof qr !== "object") throw new TemplateError(400, "Missing the QR code field.");
  const signatures = input.signatures ?? [];
  if (!Array.isArray(signatures) || signatures.length > MAX_SIGNATURES) throw new TemplateError(400, `A template can have up to ${MAX_SIGNATURES} signatures.`);
  const seen = new Set();
  return {
    text,
    qr: { x: number(qr.x, 0, 100, "QR X"), y: number(qr.y, 0, 100, "QR Y"), size: number(qr.size, 6, 40, "QR size") },
    signatures: signatures.map((signature, index) => {
      const label = `Signature ${index + 1}`;
      const id = String(signature?.signatureID ?? "");
      if (!signatureIDs.includes(id) || seen.has(id)) throw new TemplateError(400, `${label} doesn't belong to this template. Reload and try again.`);
      seen.add(id);
      return {
        signatureID: id, x: number(signature.x, 0, 100, `${label} X`), y: number(signature.y, 0, 100, `${label} Y`),
        width: number(signature.width, 5, 60, `${label} width`), line: signature.line === true,
        name: caption(signature.name, `${label} name`), title: caption(signature.title, `${label} title`),
        size: number(signature.size, 0.5, 6, `${label} caption size`), font: font(signature.font, `${label} font`),
        color: color(signature.color, `${label} color`),
      };
    }),
  };
}

// JSON a certificate is rendered from; `t` is a certificate_template alias. URLs are versioned so caches never serve a replaced image.
export const templateJson = t => `json_build_object(
  'templateID', ${t}."templateID"::text, 'width', ${t}."imageWidth", 'height', ${t}."imageHeight", 'fields', ${t}."fields",
  'imageUrl', '/api/certificate-templates/' || ${t}."templateID" || '/image?v=' || floor(extract(epoch FROM ${t}."updatedAt") * 1000)::bigint,
  'signatures', COALESCE((SELECT json_agg(json_build_object('signatureID', g."signatureID"::text,
    'imageUrl', '/api/certificate-templates/' || ${t}."templateID" || '/signatures/' || g."signatureID") ORDER BY g."signatureID")
    FROM certificate_template_signature g WHERE g."templateID" = ${t}."templateID"), '[]'::json))`;

// The template of the seminar a certificate row (alias `c`) belongs to, or NULL for the built-in design.
export const certificateTemplateSql = c => `(SELECT ${templateJson("t")} FROM seminar ts JOIN certificate_template t ON t."templateID" = ts."templateID"
  WHERE ts."seminarID" = ${c}."seminarID") AS "template"`;
