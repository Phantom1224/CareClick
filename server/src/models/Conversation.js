const mongoose = require("mongoose");

function buildParticipantsKey(participants = []) {
  const ids = participants.map((id) => id.toString()).sort();
  return ids.join(":");
}

const conversationSchema = new mongoose.Schema(
  {
    participants: [
      { type: mongoose.Schema.Types.ObjectId, ref: "User", required: true },
    ],
    participantsKey: { type: String, unique: true, sparse: true, index: true },
    isGroup: { type: Boolean, default: false },
    name: { type: String, default: "" },
    createdBy: { type: mongoose.Schema.Types.ObjectId, ref: "User", default: null },
    lastMessageText: { type: String, default: "" },
    lastMessageAt: { type: Date, default: null },
    lastMessageSender: { type: mongoose.Schema.Types.ObjectId, ref: "User", default: null },
  },
  { timestamps: true }
);

conversationSchema.pre("validate", function (next) {
  if (!Array.isArray(this.participants) || this.participants.length < 2) {
    return next(new Error("Conversation must have at least two participants"));
  }
  if (this.isGroup) {
    this.participantsKey = undefined;;
  } else {
    this.participantsKey = buildParticipantsKey(this.participants);
  }
  return next();
});

conversationSchema.statics.buildParticipantsKey = buildParticipantsKey;

module.exports = mongoose.model("Conversation", conversationSchema);
