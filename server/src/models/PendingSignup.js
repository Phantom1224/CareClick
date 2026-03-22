const mongoose = require("mongoose");

const pendingSignupSchema = new mongoose.Schema(
  {
    emailAddress: { type: String, required: true, unique: true, index: true },
    userName: { type: String, required: true },
    passwordHash: { type: String, required: true },
    validIdImage: {
      fileId: mongoose.Schema.Types.ObjectId,
      filename: String,
      mime: String,
      originalName: String,
      uploadedAt: Date,
    },
    codeHash: { type: String, required: true },
    expiresAt: { type: Date, required: true, index: { expireAfterSeconds: 0 } },
    resendAvailableAt: { type: Date, required: true },
  },
  { timestamps: true }
);

module.exports = mongoose.model("PendingSignup", pendingSignupSchema);
