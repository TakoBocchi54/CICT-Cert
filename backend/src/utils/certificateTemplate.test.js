import test from "node:test";
import assert from "node:assert/strict";
import { defaultFields, imageInfo, paperSize, readFields, readTemplateImage } from "./certificateTemplate.js";

function png(width, height) {
  const buffer = Buffer.alloc(33);
  Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 13]).copy(buffer);
  buffer.write("IHDR", 12, "latin1");
  buffer.writeUInt32BE(width, 16);
  buffer.writeUInt32BE(height, 20);
  return buffer;
}
function jpeg(width, height) {
  const app0 = Buffer.from([0xff, 0xe0, 0x00, 0x10, ...Buffer.from("JFIF\0"), 1, 1, 0, 0, 1, 0, 1, 0, 0]);
  const sof = Buffer.alloc(19);
  Buffer.from([0xff, 0xc0, 0x00, 0x11, 0x08]).copy(sof);
  sof.writeUInt16BE(height, 5);
  sof.writeUInt16BE(width, 7);
  return Buffer.concat([Buffer.from([0xff, 0xd8]), app0, Buffer.from([0xff, 0xff]), sof, Buffer.from([0xff, 0xd9])]);
}

test("image type and size come from the PNG or JPEG header; other files are rejected", () => {
  assert.deepEqual(imageInfo(png(3508, 2480)), { type: "image/png", width: 3508, height: 2480 });
  assert.deepEqual(imageInfo(jpeg(1650, 1275)), { type: "image/jpeg", width: 1650, height: 1275 });
  for (const file of [Buffer.from("GIF89a" + "\0".repeat(30)), Buffer.from('<svg xmlns="http://www.w3.org/2000/svg"></svg>'), Buffer.alloc(40), undefined]) {
    assert.equal(imageInfo(file), null);
  }
  assert.equal(imageInfo(Buffer.from([0xff, 0xd8, 0xff, 0xe0, 0x00, 0x00, ...Buffer.alloc(30)])), null); // corrupt segment length
});

test("paper size is detected from the proportions within 2%", () => {
  assert.deepEqual(paperSize(3508, 2480), { name: "A4", orientation: "landscape", mm: [297, 210] });
  assert.deepEqual(paperSize(1240, 1754), { name: "A4", orientation: "portrait", mm: [210, 297] });
  assert.equal(paperSize(3300, 2550).name, "Letter");
  assert.equal(paperSize(1275, 1650).orientation, "portrait");
  assert.equal(paperSize(2000, 1000), null);
  assert.equal(paperSize(1000, 1000), null);
  assert.throws(() => readTemplateImage(png(2000, 1000)), /isn't a supported paper size/);
  assert.throws(() => readTemplateImage(png(842, 595)), /too small/);
  assert.equal(readTemplateImage(png(1754, 1240)).width, 1754);
});

test("fields are whitelisted and clamped; name and QR always show; signatures must belong to the template", () => {
  const fields = defaultFields();
  assert.deepEqual(readFields(fields, []), fields);
  fields.text.recipientName.show = false;
  fields.text.seminarDate.show = false;
  fields.text.seminarTitle.x = 140;
  fields.extra = "ignored";
  const read = readFields(fields, []);
  assert.equal(read.text.recipientName.show, true);
  assert.equal(read.text.seminarDate.show, false);
  assert.equal(read.text.seminarTitle.x, 100);
  assert.equal(read.extra, undefined);

  const signature = { signatureID: "7", x: 30, y: 85, width: 18, line: true, name: " Dr. Maria Santos ", title: "Dean, CICT", size: 1.4, font: "sans", color: "#16231D" };
  assert.deepEqual(readFields({ ...defaultFields(), signatures: [signature] }, ["7"]).signatures[0],
    { ...signature, name: "Dr. Maria Santos", color: "#16231d" });
  assert.throws(() => readFields({ ...defaultFields(), signatures: [signature] }, ["8"]), /doesn't belong/);
  assert.throws(() => readFields({ ...defaultFields(), signatures: [signature, signature] }, ["7"]), /doesn't belong/);
  assert.throws(() => readFields({ ...defaultFields(), signatures: Array(4).fill(signature) }, ["7"]), /up to 3/);

  for (const [path, value, message] of [["color", "red", /color/], ["font", "comic", /font/], ["align", "middle", /alignment/], ["size", "5", /number/]]) {
    const bad = defaultFields();
    bad.text.seminarTitle[path] = value;
    assert.throws(() => readFields(bad, []), message);
  }
  assert.throws(() => readFields({ text: defaultFields().text }, []), /QR/);
  assert.throws(() => readFields(null, []), /required/);
});
