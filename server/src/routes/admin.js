const express = require("express");
const requireAuth = require("../middleware/requireAuth");
const requireAdmin = require("../middleware/requireAdmin");
const User = require("../models/User");
const { sendError, sendOk } = require("../utils/http");
const { isValidObjectId } = require("../utils/validation");

const router = express.Router();

router.get("/users", requireAuth, requireAdmin, async (_req, res) => {
  try {
    const users = await User.find({})
      .sort({ createdAt: -1 })
      .lean();

    const payload = users.map((user) => ({
      _id: user._id,
      userName: user.userName,
      emailAddress: user.emailAddress,
      role: user.role,
      validIdImage: user.validIdImage || null,
      createdAt: user.createdAt,
      lastSeenAt: user.lastSeenAt || null,
    }));

    return sendOk(res, { users: payload });
  } catch (_error) {
    return sendError(res, 500, "Unable to load users");
  }
});

router.patch("/users/:userId/role", requireAuth, requireAdmin, async (req, res) => {
  try {
    const { userId } = req.params;
    const nextRole = String(req.body.role || "").toLowerCase();

    if (!isValidObjectId(userId)) {
      return sendError(res, 400, "Invalid user id");
    }

    if (!["user", "admin"].includes(nextRole)) {
      return sendError(res, 400, "Invalid role");
    }

    const user = await User.findByIdAndUpdate(
      userId,
      { role: nextRole },
      { new: true }
    );

    if (!user) {
      return sendError(res, 404, "User not found");
    }

    return sendOk(res, {
      user: {
        _id: user._id,
        role: user.role,
      },
    });
  } catch (_error) {
    return sendError(res, 500, "Unable to update role");
  }
});

router.delete("/users/:userId", requireAuth, requireAdmin, async (req, res) => {
  try {
    const { userId } = req.params;

    if (!isValidObjectId(userId)) {
      return sendError(res, 400, "Invalid user id");
    }

    const deleted = await User.findByIdAndDelete(userId);
    if (!deleted) {
      return sendError(res, 404, "User not found");
    }

    return sendOk(res, { message: "User deleted" });
  } catch (_error) {
    return sendError(res, 500, "Unable to delete user");
  }
});

module.exports = router;
