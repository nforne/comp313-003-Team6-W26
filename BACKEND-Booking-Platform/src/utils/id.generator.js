// src/utils/id.generator.js
const crypto = require('crypto');

function generateNumericId(length = 16) {
  // generate a numeric string of requested length
  let id = '';
  while (id.length < length) {
    id += Math.floor(Math.random() * 10).toString();
  }
  return id.slice(0, length);
}

function generateServiceId() {
  const digits = generateNumericId(12);
  return `svc_${digits}`;
}

module.exports = { generateNumericId, generateServiceId };
