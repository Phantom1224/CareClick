const express = require("express");
const requireAuth = require("../middleware/requireAuth");
const User = require("../models/User");
const { emitLocationFeed, getIO } = require("../socket");

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
      return res.status(404).json({ message: "User not found" });
    }

    return res.json({ user: user.toJSON() });
  } catch (_error) {
    return res.status(500).json({ message: "Unable to load profile" });
  }
});

router.patch("/me/location", requireAuth, async (req, res) => {
  try {
    const lat = Number(req.body.lat);
    const lng = Number(req.body.lng);

    if (!Number.isFinite(lat) || !Number.isFinite(lng)) {
      return res.status(400).json({ message: "Location coordinates are required" });
    }

    if (lat < -90 || lat > 90 || lng < -180 || lng > 180) {
      return res.status(400).json({ message: "Invalid coordinate range" });
    }

    const user = await User.findById(req.auth.userId);
    if (!user) {
      return res.status(404).json({ message: "User not found" });
    }

    const now = new Date();
    user.userLocation = { lat, lng, updatedAt: now };
    user.lastSeenAt = now;
    await user.save();

    try {
      await emitLocationFeed(getIO());
    } catch (_error) {
      // Socket server might not be initialized in tests.
    }

    return res.json({ userLocation: user.userLocation });
  } catch (_error) {
    return res.status(500).json({ message: "Unable to update location" });
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
      return res.status(404).json({ message: "User not found" });
    }

    try {
      await emitLocationFeed(getIO());
    } catch (_error) {
      // Socket server might not be initialized in tests.
    }

    return res.json({ isRequesting: user.isRequesting });
  } catch (_error) {
    return res.status(500).json({ message: "Unable to update request status" });
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
      const isOnline =
        !!lastSeenAt && now.getTime() - lastSeenAt.getTime() <= ONLINE_WINDOW_MS;

      return {
        _id: user._id,
        userName: user.userName,
        emailAddress: user.emailAddress,
        role: user.role,
        userLocation: user.userLocation || null,
        isRequesting: Boolean(user.isRequesting),
        lastSeenAt: user.lastSeenAt || null,
        isOnline,
      };
    });

    return res.json({ users: locationFeed, onlineWindowMs: ONLINE_WINDOW_MS });
  } catch (_error) {
    return res.status(500).json({ message: "Unable to load location feed" });
  }
});

module.exports = router;
