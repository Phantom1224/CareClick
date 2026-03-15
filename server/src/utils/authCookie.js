const DEFAULT_AUTH_COOKIE_DAYS = 1;

function getAuthCookieName() {
  return process.env.AUTH_COOKIE_NAME || "careclick_auth";
}

function getAuthCookieDays() {
  const raw = Number(process.env.AUTH_COOKIE_DAYS);
  if (Number.isFinite(raw) && raw > 0) {
    return raw;
  }
  return DEFAULT_AUTH_COOKIE_DAYS;
}

function getAuthCookieMaxAgeMs() {
  const days = getAuthCookieDays();
  return Math.max(1, Math.round(days * 24 * 60 * 60 * 1000));
}

function getAuthCookieOptions() {
  return {
    httpOnly: true,
    sameSite: "lax",
    secure: process.env.NODE_ENV === "production",
    maxAge: getAuthCookieMaxAgeMs(),
    path: "/",
  };
}

function setAuthCookie(res, token) {
  res.cookie(getAuthCookieName(), token, getAuthCookieOptions());
}

function clearAuthCookie(res) {
  const { httpOnly, sameSite, secure, path } = getAuthCookieOptions();
  res.clearCookie(getAuthCookieName(), { httpOnly, sameSite, secure, path });
}

function parseCookieHeader(headerValue = "") {
  return headerValue
    .split(";")
    .map((part) => part.trim())
    .filter(Boolean)
    .reduce((acc, part) => {
      const eqIndex = part.indexOf("=");
      if (eqIndex === -1) return acc;
      const key = part.slice(0, eqIndex).trim();
      const value = part.slice(eqIndex + 1).trim();
      if (key) acc[key] = decodeURIComponent(value);
      return acc;
    }, {});
}

function getAuthTokenFromCookieHeader(headerValue = "") {
  const cookies = parseCookieHeader(headerValue);
  return cookies[getAuthCookieName()] || "";
}

function getAuthTokenFromRequest(req) {
  const authHeader = req.headers.authorization || "";
  if (authHeader.startsWith("Bearer ")) {
    return authHeader.slice(7).trim();
  }
  return getAuthTokenFromCookieHeader(req.headers.cookie || "");
}

function getAuthTokenExpirySeconds() {
  const days = getAuthCookieDays();
  return Math.max(1, Math.round(days * 24 * 60 * 60));
}

module.exports = {
  getAuthCookieName,
  getAuthCookieDays,
  getAuthCookieOptions,
  setAuthCookie,
  clearAuthCookie,
  getAuthTokenFromCookieHeader,
  getAuthTokenFromRequest,
  getAuthTokenExpirySeconds,
};
