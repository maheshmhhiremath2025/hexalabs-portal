const mongoose = require("mongoose");

async function connectMongoDB(url) {
    // serverSelectionTimeoutMS bumped to 120s (was 30s default) — workers boot a
    // lot of mongoose models synchronously, starving the network handshake of
    // event-loop time. Default 30s caused "Refusing to start" loops after the
    // 2026-05-23 outage. Direct mongoose.connect inside worker shell succeeds
    // in ~3.5s; only the in-process boot path needs more headroom.
    return mongoose.connect(url, {
        serverSelectionTimeoutMS: 120000,
        connectTimeoutMS: 120000,
        socketTimeoutMS: 0,
    });
}

module.exports = { connectMongoDB };
