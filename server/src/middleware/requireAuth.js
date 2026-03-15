const jwt = require("jsonwebtoken");
const { getAuthTokenFromRequest } = require("../utils/authCookie");

function requireAuth(req, res, next) {
  const token = getAuthTokenFromRequest(req);

  if (!token) {
    return res.status(401).json({ message: "Missing authentication token" });
  }

  try {
    const payload = jwt.verify(token, process.env.JWT_SECRET);
    req.auth = payload;
    return next();
  } catch (_error) {
    return res.status(401).json({ message: "Invalid or expired token" });
  }
}

module.exports = requireAuth;
