const mongoose = require("mongoose");

const hireSchema = new mongoose.Schema({
  jobId: String,
  clientId: String,
  workerId: String,
  status: { type: String, default: "pending" }, // pending, accepted, completed
  date: { type: Date, default: Date.now },
});

const Hire = mongoose.model("Hire", hireSchema);
module.exports = Hire;
