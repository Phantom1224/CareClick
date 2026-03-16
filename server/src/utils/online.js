function isOnline(lastSeenAt, now, windowMs) {
  if (!lastSeenAt) return false;
  return now.getTime() - new Date(lastSeenAt).getTime() <= windowMs;
}

module.exports = {
  isOnline,
};
