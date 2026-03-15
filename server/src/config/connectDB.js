const mongoose = require("mongoose");
const dns = require("dns");

async function connectDB(mongoUri) {
  if (!mongoUri) {
    throw new Error("MONGO_URI is not set");
  }

  const dnsServersRaw = process.env.MONGO_DNS_SERVERS;
  if (dnsServersRaw) {
    const servers = dnsServersRaw
      .split(",")
      .map((server) => server.trim())
      .filter(Boolean);
    if (servers.length > 0) {
      dns.setServers(servers);
    }
  }

  await mongoose.connect(mongoUri);
}

module.exports = connectDB;
