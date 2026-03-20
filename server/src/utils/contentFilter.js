const fs = require("fs");
const path = require("path");

const bannedWordsPath = path.resolve(__dirname, "../config/banned-words.txt");

function loadBannedWords() {
  try {
    const raw = fs.readFileSync(bannedWordsPath, "utf8");
    return raw
      .split(/\r?\n/)
      .map((line) => line.trim())
      .filter(Boolean);
  } catch (_error) {
    return [];
  }
}

function escapeRegex(value) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function filterMessage(body = "") {
  const bannedWords = loadBannedWords();
  if (!bannedWords.length) return body;

  let filtered = body;
  bannedWords.forEach((word) => {
    const pattern = new RegExp(`\\b${escapeRegex(word)}\\b`, "gi");
    filtered = filtered.replace(pattern, "***");
  });

  return filtered;
}

module.exports = {
  filterMessage,
};
