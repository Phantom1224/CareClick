const createApp = require("../src/app");
const connectDB = require("../src/config/connectDB");

let isConnected = false;

async function ensureDb(_req, _res, next) {
  if (isConnected) {
    return next();
  }

  try {
    await connectDB(process.env.MONGO_URI);
    isConnected = true;
    return next();
  } catch (error) {
    return next(error);
  }
}

const app = createApp({ onRequest: ensureDb });

app.use((_req, res) => {
  res.status(404).json({ message: "Route not found" });
});

app.use((error, _req, res, _next) => {
  console.error("Unhandled error:", error);
  res.status(500).json({ message: "Server error" });
});

module.exports = app;
