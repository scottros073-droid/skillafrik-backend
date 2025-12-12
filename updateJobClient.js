const mongoose = require("mongoose");
require("dotenv").config();
const Job = require("./models/Job"); // adjust path if needed

const jobId = "6924592f3c3952c0edd1ba34";      // your job _id
const clientId = "6924246ae2b026efb60dfcbe";   // client _id

mongoose.connect(process.env.MONGO_URI, { useNewUrlParser: true, useUnifiedTopology: true })
  .then(async () => {
    const job = await Job.findById(jobId);
    if (!job) {
      console.log("Job not found");
      return process.exit();
    }

    job.clientId = clientId;
    await job.save();

    console.log("✅ Job updated with clientId. You can now approve the delivery.");
    process.exit();
  })
  .catch(err => {
    console.error(err);
    process.exit(1);
  });
