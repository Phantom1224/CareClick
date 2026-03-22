const mongoose = require("mongoose");

const pendingPasswordResetSchema = new mongoose.Schema(
  {
    emailAddress: { type: String, required: true, unique: true, index: true },
    userId: { type: mongoose.Schema.Types.ObjectId, ref: "User", required: true },
    codeHash: { type: String, required: true },
    expiresAt: { type: Date, required: true, index: { expireAfterSeconds: 0 } },
    resendAvailableAt: { type: Date, required: true },
  },
  { timestamps: true }
);

module.exports = mongoose.model("PendingPasswordReset", pendingPasswordResetSchema);
