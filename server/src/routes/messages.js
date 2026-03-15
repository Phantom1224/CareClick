const express = require("express");
const mongoose = require("mongoose");
const requireAuth = require("../middleware/requireAuth");
const Conversation = require("../models/Conversation");
const Message = require("../models/Message");
const User = require("../models/User");

const router = express.Router();
const ONLINE_WINDOW_MS = 15000;
const MAX_LIMIT = 200;

function toDate(value) {
  if (!value) return null;
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? null : date;
}

function isOnline(lastSeenAt, now) {
  if (!lastSeenAt) return false;
  return now.getTime() - new Date(lastSeenAt).getTime() <= ONLINE_WINDOW_MS;
}

router.get("/conversations", requireAuth, async (req, res) => {
  try {
    const userId = req.auth.userId;
    const now = new Date();

    const conversations = await Conversation.find({ participants: userId })
      .sort({ lastMessageAt: -1, updatedAt: -1 })
      .populate("participants", "userName emailAddress lastSeenAt")
      .lean();

    const data = conversations.map((conversation) => {
      const other = conversation.participants.find(
        (participant) => participant._id.toString() !== userId
      );

      return {
        _id: conversation._id,
        lastMessageText: conversation.lastMessageText || "",
        lastMessageAt: conversation.lastMessageAt || conversation.updatedAt,
        otherUser: other
          ? {
              _id: other._id,
              userName: other.userName,
              emailAddress: other.emailAddress,
              lastSeenAt: other.lastSeenAt || null,
              isOnline: isOnline(other.lastSeenAt, now),
            }
          : null,
      };
    });

    return res.json({ conversations: data, onlineWindowMs: ONLINE_WINDOW_MS });
  } catch (_error) {
    return res.status(500).json({ message: "Unable to load conversations" });
  }
});

router.get("/conversations/with/:otherUserId", requireAuth, async (req, res) => {
  try {
    const userId = req.auth.userId;
    const otherUserId = req.params.otherUserId;

    if (!mongoose.Types.ObjectId.isValid(otherUserId)) {
      return res.status(400).json({ message: "Invalid user id" });
    }

    if (otherUserId === userId) {
      return res.status(400).json({ message: "Cannot start a conversation with yourself" });
    }

    const otherUser = await User.findById(otherUserId).lean();
    if (!otherUser) {
      return res.status(404).json({ message: "User not found" });
    }

    const participantsKey = Conversation.buildParticipantsKey([userId, otherUserId]);
    let conversation = await Conversation.findOne({ participantsKey })
      .populate("participants", "userName emailAddress lastSeenAt")
      .lean();

    if (!conversation) {
      try {
        conversation = await Conversation.create({
          participants: [userId, otherUserId],
        });
      } catch (error) {
        if (error?.code !== 11000) {
          throw error;
        }
      }

      if (!conversation) {
        conversation = await Conversation.findOne({ participantsKey });
      }

      if (!conversation) {
        return res.status(500).json({ message: "Unable to start conversation" });
      }

      conversation = await Conversation.findById(conversation._id)
        .populate("participants", "userName emailAddress lastSeenAt")
        .lean();
    }

    return res.json({ conversation });
  } catch (_error) {
    return res.status(500).json({ message: "Unable to start conversation" });
  }
});

router.get("/conversations/:conversationId/messages", requireAuth, async (req, res) => {
  try {
    const userId = req.auth.userId;
    const { conversationId } = req.params;

    if (!mongoose.Types.ObjectId.isValid(conversationId)) {
      return res.status(400).json({ message: "Invalid conversation id" });
    }

    const conversation = await Conversation.findOne({
      _id: conversationId,
      participants: userId,
    }).lean();

    if (!conversation) {
      return res.status(404).json({ message: "Conversation not found" });
    }

    const since = toDate(req.query.since);
    if (req.query.since && !since) {
      return res.status(400).json({ message: "Invalid since timestamp" });
    }

    const limit = Math.min(Number(req.query.limit) || 50, MAX_LIMIT);
    const query = { conversation: conversationId };
    if (since) {
      query.createdAt = { $gt: since };
    }

    const messages = await Message.find(query)
      .sort({ createdAt: 1 })
      .limit(limit)
      .lean();

    const payload = messages.map((message) => ({
      _id: message._id,
      body: message.body,
      senderId: message.sender,
      createdAt: message.createdAt,
    }));

    return res.json({ messages: payload });
  } catch (_error) {
    return res.status(500).json({ message: "Unable to load messages" });
  }
});

router.post("/conversations/:conversationId/messages", requireAuth, async (req, res) => {
  try {
    const userId = req.auth.userId;
    const { conversationId } = req.params;
    const body = String(req.body.body || "").trim();

    if (!mongoose.Types.ObjectId.isValid(conversationId)) {
      return res.status(400).json({ message: "Invalid conversation id" });
    }

    if (!body) {
      return res.status(400).json({ message: "Message body is required" });
    }

    const conversation = await Conversation.findOne({
      _id: conversationId,
      participants: userId,
    });

    if (!conversation) {
      return res.status(404).json({ message: "Conversation not found" });
    }

    const message = await Message.create({
      conversation: conversationId,
      sender: userId,
      body,
    });

    conversation.lastMessageText = body;
    conversation.lastMessageAt = message.createdAt;
    await conversation.save();

    return res.status(201).json({
      message: {
        _id: message._id,
        body: message.body,
        senderId: message.sender,
        createdAt: message.createdAt,
      },
    });
  } catch (_error) {
    return res.status(500).json({ message: "Unable to send message" });
  }
});

module.exports = router;
