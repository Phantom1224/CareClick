const express = require("express");
const mongoose = require("mongoose");
const { sendError } = require("../utils/http");

const router = express.Router();

function getStudentIdBucket() {
  if (!mongoose.connection?.db) {
    throw new Error("Database not connected");
  }
  return new mongoose.mongo.GridFSBucket(mongoose.connection.db, {
    bucketName: "studentIds",
  });
}

router.get("/student-id/:fileId", async (req, res) => {
  try {
    const { fileId } = req.params;
    if (!mongoose.Types.ObjectId.isValid(fileId)) {
      return sendError(res, 400, "Invalid file id");
    }

    const bucket = getStudentIdBucket();
    const downloadStream = bucket.openDownloadStream(
      new mongoose.Types.ObjectId(fileId)
    );

    downloadStream.on("file", (file) => {
      if (file?.contentType) {
        res.setHeader("Content-Type", file.contentType);
      }
    });

    downloadStream.on("error", () => {
      sendError(res, 404, "File not found");
    });

    downloadStream.pipe(res);
  } catch (_error) {
    return sendError(res, 500, "Unable to load file");
  }
});

module.exports = router;
