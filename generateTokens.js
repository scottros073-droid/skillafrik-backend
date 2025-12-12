const jwt = require("jsonwebtoken");

// Replace with actual MongoDB _id values
const clientId = "6924246ae2b026efb60dfcbe"; // client _id
const workerId = "692425a2e2b026efb60dfcc1"; // worker _id

// Secret from .env (make sure it matches your backend JWT_SECRET)
const secret = process.env.JWT_SECRET || "adewale_secure_token_123";

// Function to generate token
const generateToken = (id) => {
  return jwt.sign({ id }, secret, { expiresIn: "7d" });
};

// Generate tokens
const clientToken = generateToken(clientId);
const workerToken = generateToken(workerId);

// Output tokens
console.log("✅ Client Token:", clientToken);
console.log("✅ Worker Token:", workerToken);
