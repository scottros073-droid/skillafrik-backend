const mongoose = require("mongoose");
const bcrypt = require("bcryptjs");
require("dotenv").config();
const User = require("./models/User"); // Make sure path is correct

const ADMIN_EMAIL = "admin@example.com";   // Change if you want
const ADMIN_PASSWORD = "SuperSecure123";   // Change if you want

async function createAdmin() {
  try {
    await mongoose.connect(process.env.MONGO_URI, { useNewUrlParser: true, useUnifiedTopology: true });
    
    const existingAdmin = await User.findOne({ email: ADMIN_EMAIL });
    if (existingAdmin) {
      console.log("Admin already exists!");
      process.exit(0);
    }

    const hashedPassword = await bcrypt.hash(ADMIN_PASSWORD, 10);

    const admin = new User({
      name: "Admin",
      email: ADMIN_EMAIL,
      password: hashedPassword,
      role: "admin"  // Make sure your schema allows roles
    });

    await admin.save();
    console.log("Admin created successfully!");
    process.exit(0);
  } catch (err) {
    console.error(err);
    process.exit(1);
  }
}

createAdmin();
