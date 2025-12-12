// backend/middleware/adminMiddleware.js

const requireAuth = require("./authMiddleware");

// Middleware to restrict access to admins
const requireAdmin = async (req, res, next) => {
  try {
    // 1️⃣ First, run the auth middleware to ensure user is authenticated
    await requireAuth(req, res, async () => {
      // 2️⃣ Check if the authenticated user is an admin
      if (!req.user || req.user.role !== "admin") {
        return res.status(403).json({ message: "Forbidden: Admins only" });
      }

      // 3️⃣ Continue to next middleware or route
      next();
    });
  } catch (err) {
    console.error("Admin middleware error:", err.message);
    return res.status(403).json({ message: "Forbidden: Admins only" });
  }
};

module.exports = requireAdmin;
