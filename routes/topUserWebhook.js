// POST /api/payments/top-user-callback
router.post("/top-user-callback", async (req, res) => {
  try {
    const event = req.body;

    if (event.event === "charge.success" && event.data.metadata.purpose === "top_user") {
      const user = await Users.findById(event.data.metadata.userId);
      if (user) {
        user.isTopUser = true;
        user.topExpiry = Date.now() + 30*24*60*60*1000; // 30 days
        await user.save();
      }

      const payment = await Payments.findOne({ gatewayRef: event.data.reference });
      if (payment) {
        payment.status = "PAID";
        payment.paidAt = new Date();
        await payment.save();
      }
    }

    res.status(200).send("ok");
  } catch (err) {
    console.error("Top user webhook error:", err);
    res.status(500).send("error");
  }
});
