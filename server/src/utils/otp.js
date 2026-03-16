const crypto = require("crypto");

const OTP_LENGTH = 6;
const DEFAULT_OTP_EXP_MINUTES = 10;

function getOtpExpiryMinutes() {
  const minutes = Number(process.env.OTP_EXPIRES_MINUTES);
  if (Number.isFinite(minutes) && minutes > 0) {
    return minutes;
  }
  return DEFAULT_OTP_EXP_MINUTES;
}

function otpExpiresMs() {
  return getOtpExpiryMinutes() * 60 * 1000;
}

function hashOtp(code) {
  const pepper = process.env.JWT_SECRET || "careclick";
  return crypto.createHash("sha256").update(`${code}:${pepper}`).digest("hex");
}

function generateOtpCode() {
  return String(Math.floor(Math.random() * 10 ** OTP_LENGTH)).padStart(
    OTP_LENGTH,
    "0"
  );
}

function buildOtpEmailContent(code, purpose) {
  const minutes = getOtpExpiryMinutes();
  const isPasswordReset = purpose === "password-reset";
  const label = isPasswordReset ? "password reset" : "verification";

  return {
    subject: isPasswordReset
      ? "Your CareClick Password Reset Code"
      : "Your CareClick Verification Code",
    text: `Your CareClick ${label} code is ${code}. It expires in ${minutes} minutes.`,
    html: `<p>Your CareClick ${label} code is <strong>${code}</strong>.</p><p>It expires in ${minutes} minutes.</p>`,
  };
}

module.exports = {
  getOtpExpiryMinutes,
  otpExpiresMs,
  hashOtp,
  generateOtpCode,
  buildOtpEmailContent,
};
