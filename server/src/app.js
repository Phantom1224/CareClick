const express = require("express");
const authRoutes = require("./routes/auth");
const userRoutes = require("./routes/users");
const messageRoutes = require("./routes/messages");

function createApp({ onRequest } = {}) {
  const app = express();

  app.use(express.json());
  if (onRequest) {
    app.use(onRequest);
  }

  app.get("/health", (_req, res) => {
    res.json({ status: "ok" });
  });

  app.use("/api/auth", authRoutes);
  app.use("/api/users", userRoutes);
  app.use("/api/messages", messageRoutes);

  return app;
}

module.exports = createApp;
