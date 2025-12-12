exports.deliverWork = async (req, res) => {
  try {
    const workerId = req.user._id;
    const { jobId } = req.params;
    const { files, message } = req.body;

    const job = await Job.findById(jobId);
    if (!job) return res.status(404).json({ message: "Job not found" });

    // Check correct worker
    if (job.workerId.toString() !== workerId.toString()) {
      return res.status(403).json({ message: "Not authorized for this job" });
    }

    // Update delivery
    job.delivery = {
      files: files || [],
      message: message || "",
      deliveredAt: new Date(),
    };

    job.status = "DELIVERED";

    await job.save();

    res.json({
      message: "Work delivered successfully",
      jobId,
      status: "DELIVERED",
      delivery: job.delivery,
    });
  } catch (err) {
    console.error(err);
    res.status(500).json({ message: "Server error", error: err.message });
  }
};
