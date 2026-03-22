const nodemailer = require("nodemailer");
const { buildOtpEmailContent } = require("./otp");

let transporter = null;

function buildSmtpTransport() {
  const host = process.env.SMTP_HOST;
  const port = Number(process.env.SMTP_PORT || 0);
  const user = process.env.SMTP_USER;
  const pass = process.env.SMTP_PASS;
  const secure = String(process.env.SMTP_SECURE || "").toLowerCase() === "true";

  if (!host || !port) {
    return null;
  }

  return nodemailer.createTransport({
    host,
    port,
    secure,
    auth: user && pass ? { user, pass } : undefined,
  });
}

function buildGmailTransport() {
  const user = process.env.GMAIL_USER;
  const pass = process.env.GMAIL_APP_PASSWORD;
  if (!user || !pass) {
    return null;
  }
  return nodemailer.createTransport({
    service: "gmail",
    auth: { user, pass },
  });
}

function getTransporter() {
  if (transporter) return transporter;
  transporter = buildSmtpTransport() || buildGmailTransport();
  return transporter;
}

function getFromAddress() {
  return (
    process.env.SMTP_FROM ||
    process.env.SMTP_USER ||
    process.env.GMAIL_USER ||
    ""
  );
}

async function sendMail({ to, subject, text, html }) {
  const transport = getTransporter();
  const from = getFromAddress();
  if (!transport || !from || !to) {
    return { skipped: true };
  }
  await transport.sendMail({ from, to, subject, text, html });
  return { sent: true };
}

async function sendApprovalEmail(user) {
  const displayName = user?.userName || "there";
  const subject = "Your CareClick account has been approved";
  const text = `Hi ${displayName},\n\nYour CareClick account is now approved. You can sign in and start using the app.\n\nThanks,\nCareClick Team`;
  const html =
    `<div style="font-family: Arial, sans-serif; color: #1f2937;">` +
    `<p style="font-size: 20px; font-weight: 700; margin: 0 0 12px;">Hi ${displayName},</p>` +
    `<p>Your CareClick account is now approved. You can sign in and start using the app.</p>` +
    `<p style="font-size: 16px; font-weight: 600; margin: 16px 0 0;">Thanks,<br>CareClick Team</p>` +
    `</div>`;

  return sendMail({
    to: user?.emailAddress,
    subject,
    text,
    html,
  });
}

async function sendOtpEmail(toEmail, code, purpose) {
  const content = buildOtpEmailContent(code, purpose);
  return sendMail({
    to: toEmail,
    subject: content.subject,
    text: content.text,
    html: content.html,
  });
}

module.exports = { sendApprovalEmail, sendOtpEmail };
