const { publicConfig } = require("../scripts/env");

module.exports = function handler(req, res) {
  res.setHeader("Cache-Control", "no-store");
  res.setHeader("Content-Type", "application/json; charset=utf-8");
  const config = publicConfig();
  if (config.error) {
    console.error(config.error);
    res.status(500).json({ configured: false });
    return;
  }
  res.status(200).json({
    configured: config.configured,
    url: config.url || "",
    anonKey: config.anonKey || "",
  });
};
