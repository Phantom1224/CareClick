const path = require("path");
const express = require("express");
const http = require("http");
const dotenv = require("dotenv");
const connectDB = require("./config/connectDB");
const createApp = require("./app");
const { initSocket } = require("./socket");

dotenv.config();

const app = createApp();
const port = Number(process.env.PORT) || 5000;
const clientDir = path.resolve(__dirname, "../../client");

app.use(express.static(clientDir));

app.get("/", (_req, res) => {
  res.sendFile(path.join(clientDir, "Login.html"));
});

app.get("/home", (_req, res) => {
  res.sendFile(path.join(clientDir, "Home.html"));
});

app.use((_req, res) => {
  res.status(404).json({ message: "Route not found" });
});

async function start() {
  await connectDB(process.env.MONGO_URI);
  const server = http.createServer(app);
  initSocket(server);

  server.listen(port, () => {
    // Keep startup logs compact and readable.
    console.log(`Server running on http://localhost:${port}`);
  });
}

start().catch((error) => {
  console.error("Failed to start server:", error.message);
  process.exit(1);
});
