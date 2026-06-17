const mongoose = require("mongoose");
const bcrypt = require("bcryptjs");
require("./config/loadEnv");
const User = require("./models/User");

const ADMIN_EMAIL = "admin@example.com";
const ADMIN_PASSWORD = "SuperSecure123";

async function createAdmin() {
  if (!process.env.MONGO_URI) {
    console.error("❌ MONGO_URI not defined in .env");
    process.exit(1);
  }

  try {
    console.log("🔗 Connecting to MongoDB...");
    await Promise.race([
      mongoose.connect(process.env.MONGO_URI, {
        serverSelectionTimeoutMS: 10000,
        socketTimeoutMS: 10000
      }),
      new Promise((_, reject) =>
        setTimeout(() => reject(new Error('Connection timeout')), 10000)
      )
    ]);
    console.log("✅ MongoDB connected");
    
    const existingAdmin = await User.findOne({ email: ADMIN_EMAIL });
    if (existingAdmin) {
      console.log("ℹ️ Admin already exists!");
      await mongoose.connection.close();
      process.exit(0);
    }

    const hashedPassword = await bcrypt.hash(ADMIN_PASSWORD, 10);
    const admin = new User({
      name: "Admin",
      email: ADMIN_EMAIL,
      password: hashedPassword,
      role: "admin"
    });

    await admin.save();
    console.log("✅ Admin created successfully!");
    await mongoose.connection.close();
    process.exit(0);
  } catch (err) {
    console.error("❌ Error:", err.message || err);
    process.exit(1);
  }
}

createAdmin();
