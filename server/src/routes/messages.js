const express = require("express");
const requireAuth = require("../middleware/requireAuth");
const Conversation = require("../models/Conversation");
const Message = require("../models/Message");
const User = require("../models/User");
const { sendError, sendOk, sendCreated } = require("../utils/http");
const { isValidObjectId } = require("../utils/validation");
const { toDate } = require("../utils/date");
const { isOnline } = require("../utils/online");
const { filterMessage } = require("../utils/contentFilter");
const multer = require("multer");
const mongoose = require("mongoose");

const router = express.Router();
const ONLINE_WINDOW_MS = 15000;
const MAX_LIMIT = 200;
const IMAGE_MAX_BYTES = 5 * 1024 * 1024;

const imageUpload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: IMAGE_MAX_BYTES },
  fileFilter: (_req, file, cb) => {
    const isValid = ["image/jpeg", "image/png"].includes(file.mimetype);
    if (!isValid) {
      return cb(new Error("Only JPEG and PNG images are allowed"));
    }
    return cb(null, true);
  },
});

function buildConversationSummary(conversation, userId, now) {
  const other = conversation.participants.find(
    (participant) => participant._id.toString() !== userId
  );

  return {
    _id: conversation._id,
    lastMessageText: conversation.lastMessageText || "",
    lastMessageAt: conversation.lastMessageAt || conversation.updatedAt,
    lastMessageSenderId: conversation.lastMessageSender || null,
      otherUser: other
        ? {
            _id: other._id,
            userName: other.userName,
            emailAddress: other.emailAddress,
            lastSeenAt: other.lastSeenAt || null,
            isOnline: isOnline(other.lastSeenAt, now, ONLINE_WINDOW_MS),
          }
        : null,
    };
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
      return buildConversationSummary(conversation, userId, now);
    });

    return sendOk(res, { conversations: data, onlineWindowMs: ONLINE_WINDOW_MS });
  } catch (_error) {
    return sendError(res, 500, "Unable to load conversations");
  }
});

router.get("/conversations/with/:otherUserId", requireAuth, async (req, res) => {
  try {
    const userId = req.auth.userId;
    const otherUserId = req.params.otherUserId;

    if (!isValidObjectId(otherUserId)) {
      return sendError(res, 400, "Invalid user id");
    }

    if (otherUserId === userId) {
      return sendError(res, 400, "Cannot start a conversation with yourself");
    }

    const otherUser = await User.findById(otherUserId).lean();
    if (!otherUser) {
      return sendError(res, 404, "User not found");
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
        return sendError(res, 500, "Unable to start conversation");
      }

      conversation = await Conversation.findById(conversation._id)
        .populate("participants", "userName emailAddress lastSeenAt")
        .lean();
    }

    return sendOk(res, { conversation });
  } catch (_error) {
    return sendError(res, 500, "Unable to start conversation");
  }
});

router.get("/conversations/:conversationId/messages", requireAuth, async (req, res) => {
  try {
    const userId = req.auth.userId;
    const { conversationId } = req.params;

    if (!isValidObjectId(conversationId)) {
      return sendError(res, 400, "Invalid conversation id");
    }

    const conversation = await Conversation.findOne({
      _id: conversationId,
      participants: userId,
    }).lean();

    if (!conversation) {
      return sendError(res, 404, "Conversation not found");
    }

    const since = toDate(req.query.since);
    if (req.query.since && !since) {
      return sendError(res, 400, "Invalid since timestamp");
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
      messageType: message.messageType || "text",
      image: message.image || null,
      senderId: message.sender,
      createdAt: message.createdAt,
    }));

    return sendOk(res, { messages: payload });
  } catch (_error) {
    return sendError(res, 500, "Unable to load messages");
  }
});

router.get("/notifications", requireAuth, async (req, res) => {
  try {
    const userId = req.auth.userId;
    const since = toDate(req.query.since);
    if (req.query.since && !since) {
      return sendError(res, 400, "Invalid since timestamp");
    }

    const limit = Math.min(Number(req.query.limit) || 50, MAX_LIMIT);
    const conversations = await Conversation.find(
      { participants: userId },
      { _id: 1 }
    ).lean();
    const conversationIds = conversations.map((conversation) => conversation._id);

    if (!conversationIds.length) {
      return sendOk(res, { messages: [], nextSince: since || null });
    }

    const query = {
      conversation: { $in: conversationIds },
      sender: { $ne: userId },
    };
    if (since) {
      query.createdAt = { $gt: since };
    }

    const messages = await Message.find(query)
      .sort({ createdAt: 1 })
      .limit(limit)
      .populate("sender", "userName")
      .lean();

    const payload = messages.map((message) => ({
      _id: message._id,
      body: message.body,
      messageType: message.messageType || "text",
      image: message.image || null,
      senderId: message.sender?._id || message.sender,
      senderName: message.sender?.userName || "User",
      createdAt: message.createdAt,
      conversationId: message.conversation,
    }));

    const nextSince = messages.length ? messages[messages.length - 1].createdAt : since || null;
    return sendOk(res, { messages: payload, nextSince });
  } catch (_error) {
    return sendError(res, 500, "Unable to load notifications");
  }
});

router.post("/conversations/:conversationId/messages", requireAuth, async (req, res) => {
  try {
    const userId = req.auth.userId;
    const { conversationId } = req.params;
    const body = String(req.body.body || "").trim();

    if (!isValidObjectId(conversationId)) {
      return sendError(res, 400, "Invalid conversation id");
    }

    if (!body) {
      return sendError(res, 400, "Message body is required");
    }

    const filteredBody = filterMessage(body).trim();
    if (!filteredBody) {
      return sendError(res, 400, "Message content not allowed");
    }

    const conversation = await Conversation.findOne({
      _id: conversationId,
      participants: userId,
    });

    if (!conversation) {
      return sendError(res, 404, "Conversation not found");
    }

    const message = await Message.create({
      conversation: conversationId,
      sender: userId,
      body: filteredBody,
    });

    conversation.lastMessageText = filteredBody;
    conversation.lastMessageAt = message.createdAt;
    conversation.lastMessageSender = userId;
    await conversation.save();

    return sendCreated(res, {
      message: {
        _id: message._id,
        body: message.body,
        messageType: message.messageType || "text",
        image: message.image || null,
        senderId: message.sender,
        createdAt: message.createdAt,
      },
    });
  } catch (_error) {
    return sendError(res, 500, "Unable to send message");
  }
});

function getChatImageBucket() {
  if (!mongoose.connection?.db) {
    throw new Error("Database not connected");
  }
  return new mongoose.mongo.GridFSBucket(mongoose.connection.db, {
    bucketName: "chatImages",
  });
}

function uploadChatImage(file) {
  return new Promise((resolve, reject) => {
    const bucket = getChatImageBucket();
    const uploadStream = bucket.openUploadStream(file.originalname || "chat-image", {
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

const chatImageUpload = (req, res, next) => {
  imageUpload.single("image")(req, res, (error) => {
    if (error) {
      return sendError(res, 400, error.message || "Unable to upload image");
    }
    return next();
  });
};

router.post("/conversations/:conversationId/images", requireAuth, chatImageUpload, async (req, res) => {
  try {
    const userId = req.auth.userId;
    const { conversationId } = req.params;

    if (!isValidObjectId(conversationId)) {
      return sendError(res, 400, "Invalid conversation id");
    }

    if (!req.file) {
      return sendError(res, 400, "Image is required");
    }

    const conversation = await Conversation.findOne({
      _id: conversationId,
      participants: userId,
    });

    if (!conversation) {
      return sendError(res, 404, "Conversation not found");
    }

    const fileId = await uploadChatImage(req.file);

    const message = await Message.create({
      conversation: conversationId,
      sender: userId,
      messageType: "image",
      body: "[Image]",
      image: {
        fileId,
        mime: req.file.mimetype,
        originalName: req.file.originalname,
      },
    });

    conversation.lastMessageText = "[Image]";
    conversation.lastMessageAt = message.createdAt;
    conversation.lastMessageSender = userId;
    await conversation.save();

    return sendCreated(res, {
      message: {
        _id: message._id,
        body: message.body,
        messageType: message.messageType,
        image: message.image || null,
        senderId: message.sender,
        createdAt: message.createdAt,
      },
    });
  } catch (_error) {
    return sendError(res, 500, "Unable to send image");
  }
});

module.exports = router;
