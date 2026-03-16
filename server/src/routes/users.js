const express = require("express");
const requireAuth = require("../middleware/requireAuth");
const User = require("../models/User");
const { sendError, sendOk } = require("../utils/http");
const { parseCoordinate, isValidLatLng } = require("../utils/validation");
const { isOnline } = require("../utils/online");

const router = express.Router();
const ONLINE_WINDOW_MS = 15000;

router.get("/me", requireAuth, async (req, res) => {
  try {
    const user = await User.findByIdAndUpdate(
      req.auth.userId,
      { lastSeenAt: new Date() },
      { new: true }
    );
    if (!user) {
      return sendError(res, 404, "User not found");
    }

    return sendOk(res, { user: user.toJSON() });
  } catch (_error) {
    return sendError(res, 500, "Unable to load profile");
  }
});

router.patch("/me/location", requireAuth, async (req, res) => {
  try {
    const lat = parseCoordinate(req.body.lat);
    const lng = parseCoordinate(req.body.lng);

    if (lat === null || lng === null) {
      return sendError(res, 400, "Location coordinates are required");
    }

    if (!isValidLatLng(lat, lng)) {
      return sendError(res, 400, "Invalid coordinate range");
    }

    const user = await User.findById(req.auth.userId);
    if (!user) {
      return sendError(res, 404, "User not found");
    }

    const now = new Date();
    user.userLocation = { lat, lng, updatedAt: now };
    user.lastSeenAt = now;
    await user.save();

    return sendOk(res, { userLocation: user.userLocation });
  } catch (_error) {
    return sendError(res, 500, "Unable to update location");
  }
});

router.patch("/me/requesting", requireAuth, async (req, res) => {
  try {
    const isRequesting = Boolean(req.body.isRequesting);

    const user = await User.findByIdAndUpdate(
      req.auth.userId,
      { isRequesting, lastSeenAt: new Date() },
      { new: true }
    );
    if (!user) {
      return sendError(res, 404, "User not found");
    }

    return sendOk(res, { isRequesting: user.isRequesting });
  } catch (_error) {
    return sendError(res, 500, "Unable to update request status");
  }
});

router.get("/location-feed", requireAuth, async (req, res) => {
  try {
    const now = new Date();
    await User.findByIdAndUpdate(req.auth.userId, { lastSeenAt: now });

    const users = await User.find(
      {},
      { userName: 1, emailAddress: 1, role: 1, userLocation: 1, isRequesting: 1, lastSeenAt: 1 }
    ).lean();

    const locationFeed = users.map((user) => {
      const lastSeenAt = user.lastSeenAt ? new Date(user.lastSeenAt) : null;
      const isUserOnline = isOnline(lastSeenAt, now, ONLINE_WINDOW_MS);

      return {
        _id: user._id,
        userName: user.userName,
        emailAddress: user.emailAddress,
        role: user.role,
        userLocation: user.userLocation || null,
        isRequesting: Boolean(user.isRequesting),
        lastSeenAt: user.lastSeenAt || null,
        isOnline: isUserOnline,
      };
    });

    return sendOk(res, { users: locationFeed, onlineWindowMs: ONLINE_WINDOW_MS });
  } catch (_error) {
    return sendError(res, 500, "Unable to load location feed");
  }
});

module.exports = router;
