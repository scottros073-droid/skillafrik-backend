require("dotenv").config();
const axios = require("axios");
const jwt = require("jsonwebtoken");

const BASE_URL = "http://localhost:5000/api"; // adjust if needed
const JOB_ID = "69244632d01eae527eb89fb1";    // your job _id
const CLIENT_ID = "YOUR_CLIENT_ID_HERE";      // replace with actual client _id
const WORKER_ID = "692425a2e2b026efb60dfcc1"; // your worker _id

// ---------------------------
// Generate tokens
// ---------------------------
const clientToken = jwt.sign({ id: CLIENT_ID }, process.env.JWT_SECRET, { expiresIn: "7d" });
const workerToken = jwt.sign({ id: WORKER_ID }, process.env.JWT_SECRET, { expiresIn: "7d" });

console.log("Client Token:", clientToken);
console.log("Worker Token:", workerToken);

// ---------------------------
// Approve job delivery (Client)
// ---------------------------
async function approveJob() {
  try {
    const res = await axios.post(
      `${BASE_URL}/jobs/${JOB_ID}/approve`,
      {},
      { headers: { Authorization: `Bearer ${clientToken}` } }
    );

    console.log("✅ Delivery approved:");
    console.log(res.data);
  } catch (err) {
    if (err.response) {
      console.error("❌ Error:", err.response.status, err.response.data);
    } else {
      console.error(err);
    }
  }
}

approveJob();
