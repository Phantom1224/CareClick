const mongoose = require("mongoose");

function normalizeEmail(value = "") {
  return String(value).trim().toLowerCase();
}

function normalizeUserName(value = "") {
  return String(value).trim();
}

function isSixDigitCode(value = "") {
  return /^\d{6}$/.test(String(value).trim());
}

function isStrongPassword(value = "") {
  return String(value).length >= 8;
}

function isValidObjectId(value = "") {
  return mongoose.Types.ObjectId.isValid(value);
}

function parseCoordinate(value) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

function isValidLatLng(lat, lng) {
  return (
    Number.isFinite(lat) &&
    Number.isFinite(lng) &&
    lat >= -90 &&
    lat <= 90 &&
    lng >= -180 &&
    lng <= 180
  );
}

module.exports = {
  normalizeEmail,
  normalizeUserName,
  isSixDigitCode,
  isStrongPassword,
  isValidObjectId,
  parseCoordinate,
  isValidLatLng,
};
