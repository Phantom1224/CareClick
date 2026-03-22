const bcrypt = require("bcryptjs");
const express = require("express");
const jwt = require("jsonwebtoken");
const multer = require("multer");
const User = require("../models/User");
const mongoose = require("mongoose");
const PendingSignup = require("../models/PendingSignup");
const PendingPasswordReset = require("../models/PendingPasswordReset");
const { sendError, sendOk, sendCreated } = require("../utils/http");
const {
  normalizeEmail,
  normalizeUserName,
  isSixDigitCode,
  isStrongPassword,
} = require("../utils/validation");
const { generateOtpCode, hashOtp, otpExpiresMs } = require("../utils/otp");
const { sendOtpEmail } = require("../utils/mailer");
const {
  setAuthCookie,
  clearAuthCookie,
  getAuthTokenExpirySeconds,
} = require("../utils/authCookie");

const router = express.Router();

const OTP_RESEND_COOLDOWN_MS = 60 * 1000;
const otpRequestInFlight = new Set();

const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 5 * 1024 * 1024 },
  fileFilter: (_req, file, cb) => {
    const isValid = ["image/jpeg", "image/png"].includes(file.mimetype);
    if (!isValid) {
      return cb(new Error("Only JPEG and PNG images are allowed"));
    }
    return cb(null, true);
  },
});

function buildToken(user) {
  return jwt.sign(
    { userId: user._id.toString(), role: user.role },
    process.env.JWT_SECRET,
    { expiresIn: getAuthTokenExpirySeconds() }
  );
}


function duplicateErrorResponse(error, res) {
  const duplicateField =
    Object.keys(error?.keyPattern || {})[0] ||
    Object.keys(error?.keyValue || {})[0];
  const duplicateValue = duplicateField ? error?.keyValue?.[duplicateField] : undefined;

  if (duplicateField === "emailAddress") {
    return sendError(res, 409, "Email already registered");
  }

  if (duplicateField === "userName") {
    return sendError(res, 409, "Username already taken");
  }

  if (duplicateField) {
    return sendError(
      res,
      409,
      `Duplicate value already exists for ${duplicateField}: ${String(duplicateValue)}`
    );
  }

  return sendError(res, 409, "Duplicate value already exists");
}

const signupIdUpload = (req, res, next) => {
  upload.single("studentIdImage")(req, res, (error) => {
    if (error) {
      return sendError(res, 400, error.message || "Unable to upload ID image");
    }
    return next();
  });
};

function getStudentIdBucket() {
  if (!mongoose.connection?.db) {
    throw new Error("Database not connected");
  }
  return new mongoose.mongo.GridFSBucket(mongoose.connection.db, {
    bucketName: "studentIds",
  });
}

function uploadStudentIdToGridFS(file) {
  return new Promise((resolve, reject) => {
    const bucket = getStudentIdBucket();
    const uploadStream = bucket.openUploadStream(file.originalname || "student-id", {
      contentType: file.mimetype,
      metadata: {
        originalName: file.originalname,
        uploadedAt: new Date(),
      },
    });

    uploadStream.on("error", reject);
    uploadStream.on("finish", () => resolve(uploadStream.id));
    uploadStream.end(file.buffer);
  });
}

async function cleanupPendingSignup(pending) {
  if (!pending) return;
  const fileId = pending?.validIdImage?.fileId;
  if (fileId && mongoose.connection?.db && mongoose.Types.ObjectId.isValid(fileId)) {
    try {
      const bucket = getStudentIdBucket();
      await bucket.delete(new mongoose.Types.ObjectId(fileId));
    } catch (_error) {
      // Ignore cleanup failures.
    }
  }
  try {
    await PendingSignup.deleteOne({ emailAddress: pending.emailAddress });
  } catch (_error) {
    // Ignore cleanup failures.
  }
}

router.post("/signup/request-code", signupIdUpload, async (req, res) => {
  try {
    const { userName, emailAddress, password, confirmPassword } = req.body;

    if (!userName || !emailAddress || !password || !confirmPassword) {
      return sendError(res, 400, "All required fields must be provided");
    }

    if (!req.file) {
      return sendError(res, 400, "Valid ID image is required");
    }

    if (password !== confirmPassword) {
      return sendError(res, 400, "Passwords do not match");
    }

    const normalizedEmail = normalizeEmail(emailAddress);
    const trimmedUserName = normalizeUserName(userName);

    const existingEmail = await User.findOne({ emailAddress: normalizedEmail });
    if (existingEmail) {
      return sendError(res, 409, "Email already registered");
    }

    const existingUserName = await User.findOne({ userName: trimmedUserName });
    if (existingUserName) {
      return sendError(res, 409, "Username already taken");
    }

    const existingPending = await PendingSignup.findOne({
      emailAddress: normalizedEmail,
    });
    const now = Date.now();
    if (existingPending && now > existingPending.expiresAt.getTime()) {
      await cleanupPendingSignup(existingPending);
    } else if (existingPending && now < existingPending.resendAvailableAt.getTime()) {
      const waitSeconds = Math.ceil(
        (existingPending.resendAvailableAt.getTime() - now) / 1000
      );
      return sendError(
        res,
        429,
        `Please wait ${waitSeconds}s before requesting another code`
      );
    }

    if (existingPending && now <= existingPending.expiresAt.getTime()) {
      await cleanupPendingSignup(existingPending);
    }

    const fileId = await uploadStudentIdToGridFS(req.file);
    const code = generateOtpCode();
    const passwordHash = await bcrypt.hash(password, 10);

    await PendingSignup.findOneAndUpdate(
      { emailAddress: normalizedEmail },
      {
        userName: trimmedUserName,
        emailAddress: normalizedEmail,
        passwordHash,
        validIdImage: {
          fileId,
          filename: req.file.originalname || "student-id",
          mime: req.file.mimetype,
          originalName: req.file.originalname,
          uploadedAt: new Date(),
        },
        codeHash: hashOtp(code),
        expiresAt: new Date(now + otpExpiresMs()),
        resendAvailableAt: new Date(now + OTP_RESEND_COOLDOWN_MS),
      },
      { upsert: true, new: true }
    );

    await sendOtpEmail(normalizedEmail, code, "verification");
    return sendOk(res, { message: "Verification code sent to email" });
  } catch (error) {
    return sendError(res, 500, "Unable to send verification code");
  }
});

router.post("/signup/resend-code", async (req, res) => {
  try {
    const normalizedEmail = normalizeEmail(req.body.emailAddress);
    if (!normalizedEmail) {
      return sendError(res, 400, "Email is required");
    }

    const pending = await PendingSignup.findOne({ emailAddress: normalizedEmail });
    if (!pending) {
      return sendError(res, 404, "No pending signup found for this email");
    }

    const now = Date.now();
    if (now > pending.expiresAt.getTime()) {
      await cleanupPendingSignup(pending);
      return sendError(res, 400, "Verification code has expired. Request a new code.");
    }

    if (now < pending.resendAvailableAt.getTime()) {
      const waitSeconds = Math.ceil((pending.resendAvailableAt.getTime() - now) / 1000);
      return sendError(res, 429, `Please wait ${waitSeconds}s before resending`);
    }

    const code = generateOtpCode();
    pending.codeHash = hashOtp(code);
    pending.expiresAt = new Date(now + otpExpiresMs());
    pending.resendAvailableAt = new Date(now + OTP_RESEND_COOLDOWN_MS);
    await pending.save();

    await sendOtpEmail(normalizedEmail, code, "verification");
    return sendOk(res, { message: "Verification code resent" });
  } catch (_error) {
    return sendError(res, 500, "Unable to resend verification code");
  }
});

router.post("/signup/verify-code", async (req, res) => {
  try {
    const normalizedEmail = normalizeEmail(req.body.emailAddress);
    const code = String(req.body.code || "").trim();

    if (!normalizedEmail || !code) {
      return sendError(res, 400, "Email and verification code are required");
    }

    if (!isSixDigitCode(code)) {
      return sendError(res, 400, "Verification code must be a 6-digit number");
    }

    const pending = await PendingSignup.findOne({ emailAddress: normalizedEmail });
    if (!pending) {
      return sendError(res, 404, "No pending signup found for this email");
    }

    if (Date.now() > pending.expiresAt.getTime()) {
      await cleanupPendingSignup(pending);
      return sendError(res, 400, "Verification code has expired. Request a new code.");
    }

    if (hashOtp(code) !== pending.codeHash) {
      return sendError(res, 400, "Invalid verification code");
    }

    const existingUser = await User.findOne({ emailAddress: normalizedEmail });
    if (existingUser) {
      await cleanupPendingSignup(pending);
      return sendError(res, 409, "Email already registered");
    }

    const existingUserName = await User.findOne({ userName: pending.userName });
    if (existingUserName) {
      await cleanupPendingSignup(pending);
      return sendError(res, 409, "Username already taken");
    }

    const user = await User.create({
      userName: pending.userName,
      emailAddress: pending.emailAddress,
      passwordHash: pending.passwordHash,
      role: "user",
      isApproved: false,
      validIdImage: pending.validIdImage,
    });

    await PendingSignup.deleteOne({ emailAddress: normalizedEmail });
    return sendCreated(res, {
      message: "Account created. Awaiting admin approval.",
      user: user.toJSON(),
    });
  } catch (error) {
    if (error?.code === 11000) {
      return duplicateErrorResponse(error, res);
    }

    return sendError(res, 500, "Unable to verify signup code");
  }
});

router.post("/password/request-code", async (req, res) => {
  const normalizedEmail = normalizeEmail(req.body.emailAddress);
  if (!normalizedEmail) {
    return sendError(res, 400, "Email is required");
  }

  if (otpRequestInFlight.has(normalizedEmail)) {
    return sendError(res, 429, "Please wait before requesting another code");
  }

  otpRequestInFlight.add(normalizedEmail);

  try {
    const user = await User.findOne({ emailAddress: normalizedEmail });
    if (!user) {
      return sendError(res, 404, "No account found for that email");
    }

    const existing = await PendingPasswordReset.findOne({
      emailAddress: normalizedEmail,
    });
    const now = Date.now();
    if (existing && now < existing.resendAvailableAt.getTime()) {
      const waitSeconds = Math.ceil(
        (existing.resendAvailableAt.getTime() - now) / 1000
      );
      return sendError(
        res,
        429,
        `Please wait ${waitSeconds}s before requesting another code`
      );
    }

    const code = generateOtpCode();
    await PendingPasswordReset.findOneAndUpdate(
      { emailAddress: normalizedEmail },
      {
        userId: user._id,
        emailAddress: normalizedEmail,
        codeHash: hashOtp(code),
        expiresAt: new Date(now + otpExpiresMs()),
        resendAvailableAt: new Date(now + OTP_RESEND_COOLDOWN_MS),
      },
      { upsert: true, new: true }
    );

    await sendOtpEmail(normalizedEmail, code, "password-reset");
    return sendOk(res, { message: "Password reset code sent to email" });
  } catch (_error) {
    return sendError(res, 500, "Unable to send password reset code");
  } finally {
    otpRequestInFlight.delete(normalizedEmail);
  }
});

router.post("/password/resend-code", async (req, res) => {
  try {
    const normalizedEmail = normalizeEmail(req.body.emailAddress);
    if (!normalizedEmail) {
      return sendError(res, 400, "Email is required");
    }

    const pending = await PendingPasswordReset.findOne({
      emailAddress: normalizedEmail,
    });
    if (!pending) {
      return sendError(res, 404, "No pending reset found for this email");
    }

    const now = Date.now();
    if (now < pending.resendAvailableAt.getTime()) {
      const waitSeconds = Math.ceil((pending.resendAvailableAt.getTime() - now) / 1000);
      return sendError(res, 429, `Please wait ${waitSeconds}s before resending`);
    }

    const code = generateOtpCode();
    pending.codeHash = hashOtp(code);
    pending.expiresAt = new Date(now + otpExpiresMs());
    pending.resendAvailableAt = new Date(now + OTP_RESEND_COOLDOWN_MS);
    await pending.save();

    await sendOtpEmail(normalizedEmail, code, "password-reset");
    return sendOk(res, { message: "Password reset code resent" });
  } catch (_error) {
    return sendError(res, 500, "Unable to resend password reset code");
  }
});

router.post("/password/reset", async (req, res) => {
  try {
    const normalizedEmail = normalizeEmail(req.body.emailAddress);
    const code = String(req.body.code || "").trim();
    const newPassword = String(req.body.newPassword || "");
    const confirmPassword = String(req.body.confirmPassword || "");

    if (!normalizedEmail || !code || !newPassword || !confirmPassword) {
      return sendError(res, 400, "All required fields must be provided");
    }

    if (newPassword !== confirmPassword) {
      return sendError(res, 400, "Passwords do not match");
    }

    if (!isStrongPassword(newPassword)) {
      return sendError(res, 400, "Password must be at least 8 characters long");
    }

    if (!isSixDigitCode(code)) {
      return sendError(res, 400, "Verification code must be a 6-digit number");
    }

    const pending = await PendingPasswordReset.findOne({
      emailAddress: normalizedEmail,
    });
    if (!pending) {
      return sendError(res, 404, "No pending reset found for this email");
    }

    if (Date.now() > pending.expiresAt.getTime()) {
      await PendingPasswordReset.deleteOne({ emailAddress: normalizedEmail });
      return sendError(res, 400, "Verification code has expired. Request a new code.");
    }

    if (hashOtp(code) !== pending.codeHash) {
      return sendError(res, 400, "Invalid verification code");
    }

    const user = await User.findOne({ emailAddress: normalizedEmail });
    if (!user) {
      await PendingPasswordReset.deleteOne({ emailAddress: normalizedEmail });
      return sendError(res, 404, "No account found for that email");
    }

    user.passwordHash = await bcrypt.hash(newPassword, 10);
    await user.save();

    await PendingPasswordReset.deleteOne({ emailAddress: normalizedEmail });
    return sendOk(res, { message: "Password updated successfully" });
  } catch (_error) {
    return sendError(res, 500, "Unable to reset password");
  }
});

// Backward-compatible direct signup endpoint.
router.post("/signup", async (req, res) => {
  try {
    const { userName, emailAddress, password, confirmPassword } = req.body;

    if (!userName || !emailAddress || !password || !confirmPassword) {
      return sendError(res, 400, "All required fields must be provided");
    }

    if (password !== confirmPassword) {
      return sendError(res, 400, "Passwords do not match");
    }

    const normalizedEmail = normalizeEmail(emailAddress);
    const existingUser = await User.findOne({ emailAddress: normalizedEmail });
    if (existingUser) {
      return sendError(res, 409, "Email already registered");
    }

    const passwordHash = await bcrypt.hash(password, 10);
    const user = await User.create({
      userName: normalizeUserName(userName),
      emailAddress: normalizedEmail,
      passwordHash,
      role: "user",
    });

    const token = buildToken(user);
    setAuthCookie(res, token);
    return sendCreated(res, { token, user: user.toJSON() });
  } catch (error) {
    if (error?.code === 11000) {
      return duplicateErrorResponse(error, res);
    }

    return sendError(res, 500, "Unable to create account");
  }
});

router.post("/login", async (req, res) => {
  try {
    const { emailAddress, password } = req.body;
    if (!emailAddress || !password) {
      return sendError(res, 400, "Email and password are required");
    }

    const user = await User.findOne({ emailAddress: normalizeEmail(emailAddress) });
    if (!user) {
      return sendError(res, 401, "Invalid email or password");
    }

    if (!user.isApproved) {
      return sendError(res, 403, "Account pending approval");
    }

    const isValidPassword = await bcrypt.compare(password, user.passwordHash);
    if (!isValidPassword) {
      return sendError(res, 401, "Invalid email or password");
    }

    const token = buildToken(user);
    setAuthCookie(res, token);
    return sendOk(res, { token, user: user.toJSON() });
  } catch (_error) {
    return sendError(res, 500, "Unable to sign in");
  }
});

router.post("/logout", (_req, res) => {
  clearAuthCookie(res);
  return sendOk(res, { message: "Logged out" });
});

module.exports = router;
