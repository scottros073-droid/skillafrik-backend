// backend/middleware/adminMiddleware.js

const { authMiddleware } = require("./authMiddleware");

// Middleware to restrict access to admins only
const isAdmin = async (req, res, next) => {
  // First ensure user is authenticated
  await authMiddleware(req, res, () => {
    // Then check if user is admin
    if (!req.user || req.user.role !== "admin") {
      return res.status(403).json({
        success: false,
        message: "Admin access only",
        data: {}
      });
    }
    next();
  });
};

module.exports = isAdmin;
