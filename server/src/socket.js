const { Server } = require("socket.io");
const jwt = require("jsonwebtoken");
const User = require("./models/User");
const Conversation = require("./models/Conversation");
const { getAuthTokenFromCookieHeader } = require("./utils/authCookie");

const ONLINE_WINDOW_MS = 15000;
let io = null;

function buildLocationFeedPayload(users = []) {
  const now = new Date();
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

  return { users: locationFeed, onlineWindowMs: ONLINE_WINDOW_MS };
}

async function emitLocationFeed(target) {
  if (!target) return;
  const users = await User.find(
    {},
    { userName: 1, emailAddress: 1, role: 1, userLocation: 1, isRequesting: 1, lastSeenAt: 1 }
  ).lean();
  target.emit("location:feed", buildLocationFeedPayload(users));
}

async function emitPresenceUpdate(userId, { isOnlineOverride } = {}) {
  if (!io || !userId) return;
  const now = new Date();

  const conversations = await Conversation.find(
    { participants: userId },
    { participants: 1 }
  ).lean();

  const recipientIds = new Set();
  conversations.forEach((conversation) => {
    (conversation.participants || []).forEach((participantId) => {
      const id = participantId.toString();
      if (id !== String(userId)) {
        recipientIds.add(id);
      }
    });
  });

  const payload = {
    userId,
    lastSeenAt: now,
    isOnline: typeof isOnlineOverride === "boolean" ? isOnlineOverride : true,
  };

  recipientIds.forEach((recipientId) => {
    io.to(`user:${recipientId}`).emit("chat:presence:update", payload);
  });
}

function initSocket(httpServer) {
  io = new Server(httpServer, {
    cors: { origin: true, credentials: true },
  });

  io.use((socket, next) => {
    const token =
      socket.handshake.auth?.token ||
      getAuthTokenFromCookieHeader(socket.handshake.headers?.cookie || "");
    if (!token) {
      return next(new Error("Missing auth token"));
    }

    try {
      const payload = jwt.verify(token, process.env.JWT_SECRET);
      socket.userId = payload.userId;
      return next();
    } catch (_error) {
      return next(new Error("Invalid token"));
    }
  });

  io.on("connection", (socket) => {
    const userId = socket.userId;
    if (userId) {
      socket.join(`user:${userId}`);
      User.findByIdAndUpdate(userId, { lastSeenAt: new Date() })
        .then(() => emitPresenceUpdate(userId, { isOnlineOverride: true }))
        .catch(() => {});
    }

    emitLocationFeed(socket).catch(() => {});

    socket.on("presence:ping", () => {
      if (!socket.userId) return;
      User.findByIdAndUpdate(socket.userId, { lastSeenAt: new Date() })
        .then(() => emitPresenceUpdate(socket.userId, { isOnlineOverride: true }))
        .catch(() => {});
    });

    socket.on("location:update", async (payload = {}) => {
      const lat = Number(payload.lat);
      const lng = Number(payload.lng);

      if (!Number.isFinite(lat) || !Number.isFinite(lng)) {
        socket.emit("location:error", { message: "Location coordinates are required" });
        return;
      }

      if (lat < -90 || lat > 90 || lng < -180 || lng > 180) {
        socket.emit("location:error", { message: "Invalid coordinate range" });
        return;
      }

      try {
        const user = await User.findById(socket.userId);
        if (!user) {
          socket.emit("location:error", { message: "User not found" });
          return;
        }

        const now = new Date();
        user.userLocation = { lat, lng, updatedAt: now };
        user.lastSeenAt = now;
        await user.save();

        socket.emit("location:ack", { ok: true, userLocation: user.userLocation });
        await emitLocationFeed(io);
      } catch (_error) {
        socket.emit("location:error", { message: "Unable to update location" });
      }
    });

    socket.on("chat:join", (payload = {}) => {
      const conversationId = String(payload.conversationId || "").trim();
      if (conversationId) {
        socket.join(`conversation:${conversationId}`);
      }
    });

    socket.on("chat:leave", (payload = {}) => {
      const conversationId = String(payload.conversationId || "").trim();
      if (conversationId) {
        socket.leave(`conversation:${conversationId}`);
      }
    });

    socket.on("disconnect", () => {
      if (userId) {
        User.findByIdAndUpdate(userId, { lastSeenAt: new Date() })
          .then(() => emitPresenceUpdate(userId, { isOnlineOverride: false }))
          .catch(() => {});
      }
      emitLocationFeed(io).catch(() => {});
    });
  });

  return io;
}

function getIO() {
  if (!io) {
    throw new Error("Socket.io not initialized");
  }
  return io;
}

function emitToUser(userId, event, payload) {
  if (!io || !userId) return;
  io.to(`user:${userId}`).emit(event, payload);
}

function emitToConversation(conversationId, event, payload) {
  if (!io || !conversationId) return;
  io.to(`conversation:${conversationId}`).emit(event, payload);
}

module.exports = {
  initSocket,
  getIO,
  emitLocationFeed,
  emitToUser,
  emitToConversation,
  buildLocationFeedPayload,
};
