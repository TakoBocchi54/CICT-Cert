import test from "node:test";
import assert from "node:assert/strict";
import { formatCertificateNo, parseCertificateNoQuery } from "./certificateNumber.js";

test("certificate numbers are shown as the seminar date and a four-digit number", () => {
  assert.equal(formatCertificateNo(1, "2026-11-18"), "20261118-0001");
  assert.equal(formatCertificateNo(123456, "2027-01-05"), "20270105-123456");
  assert.equal(formatCertificateNo(42), "0042");
});

test("a registry search accepts the shown format, #n or the bare number", () => {
  for (const q of ["20261118-0042", "#42", "0042", "42"]) assert.equal(parseCertificateNoQuery(q), "42", q);
  assert.equal(parseCertificateNoQuery("0"), "0");
  assert.equal(parseCertificateNoQuery("Maria"), "Maria", "names pass through unchanged");
});
