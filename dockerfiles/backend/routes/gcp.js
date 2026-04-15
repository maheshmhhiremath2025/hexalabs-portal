const express = require("express")
const router = express.Router();

const {handleCreateTraining, handleGetTraining, handleDeleteTraining, handleGetProject, handleUpdateBilling, handleCleanProject} = require("./../controllers/gcp/handleTraining")
router.post("/training", handleCreateTraining)
router.get("/training", handleGetTraining)
router.delete("/training", handleDeleteTraining)
router.get("/projects", handleGetProject)
router.patch("/projects", handleUpdateBilling)
router.put("/projects", handleCleanProject)
module.exports = router