function sendError(res, status, message) {
  return res.status(status).json({ message });
}

function sendOk(res, payload) {
  return res.json(payload);
}

function sendCreated(res, payload) {
  return res.status(201).json(payload);
}

module.exports = {
  sendError,
  sendOk,
  sendCreated,
};
