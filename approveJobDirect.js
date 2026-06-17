// approveJobDirectFull.js
require("./config/loadEnv");
const mongoose = require("mongoose");
const Job = require("./models/Job");
const Payment = require("./models/Payment");

const jobId = "69245eee67372d9b591844b0";
const clientId = "6924246ae2b026efb60dfcbe";

if (!process.env.MONGO_URI) {
  console.error("❌ MONGO_URI not defined in .env");
  process.exit(1);
}

Promise.race([
  mongoose.connect(process.env.MONGO_URI, {
    serverSelectionTimeoutMS: 10000,
    socketTimeoutMS: 10000
  }),
  new Promise((_, reject) =>
    setTimeout(() => reject(new Error('Connection timeout')), 10000)
  )
])
  .then(async () => {
    console.log("✅ MongoDB connected");
    const job = await Job.findById(jobId);
    if (!job) {
      console.log("❌ Job not found");
      await mongoose.connection.close();
      process.exit(1);
    }

    if (!job.clientId) {
      job.clientId = clientId;
      console.log("✅ Client assigned to job");
    }

    if (job.status !== "DELIVERED") {
      job.status = "DELIVERED";
      job.delivery = { files: ["file1.pdf"], message: "Work completed. Please check.", deliveredAt: new Date() };
      console.log("✅ Job delivery simulated");
    }

    if (!job.escrowPaid) {
      job.escrowPaid = true;
      job.escrow = { status: "HELD" };
      // Create a dummy payment record
      await Payment.create({ jobId, userId: clientId, amount: job.amount, purpose: "job_escrow", status: "PAID", gateway: "paystack" });
      console.log("✅ Escrow simulated as paid");
    }

    // Approve job and release escrow
    job.status = "COMPLETED";
    job.escrow.status = "RELEASED";
    job.platformEarnings = job.amount * 0.10; // 10%
    job.workerEarnings = job.amount * 0.90;   // 90%
    await job.save();
    console.log("✅ Job approved and escrow released");

    console.log(job);
    process.exit();
  })
  .catch(err => console.error(err));
