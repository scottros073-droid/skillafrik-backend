// backend/config/corsConfig.js

const splitOrigins = (value = "") => (
  String(value)
    .split(",")
    .map((origin) => origin.trim().replace(/\/+$/u, ""))
    .filter(Boolean)
);

const getAllowedOrigins = () => {
  const envOrigins = [
    ...splitOrigins(process.env.CLIENT_URL),
    ...splitOrigins(process.env.FRONTEND_URL),
    ...splitOrigins(process.env.PRODUCTION_FRONTEND_URL),
    process.env.VERCEL_URL ? `https://${process.env.VERCEL_URL}` : "",
    "https://afrikskill-hash.vercel.app",
    "http://localhost:5173",
    "http://127.0.0.1:5173",
  ].filter(Boolean);

  return Array.from(new Set(envOrigins.map((origin) => origin.replace(/\/+$/u, ""))));
};

const corsOptions = {
  origin(origin, callback) {
    if (!origin) return callback(null, true);

    const normalizedOrigin = origin.replace(/\/+$/u, "");
    const allowedOrigins = getAllowedOrigins();
    const isVercelPreview = /^https:\/\/afrikskill-hash(-[a-z0-9-]+)?\.vercel\.app$/i.test(normalizedOrigin);

    if (allowedOrigins.includes(normalizedOrigin) || isVercelPreview) {
      return callback(null, true);
    }

    return callback(new Error(`CORS blocked: ${normalizedOrigin}`));
  },
  credentials: true,
  methods: ["GET", "POST", "PUT", "PATCH", "DELETE", "OPTIONS"],
  allowedHeaders: ["Content-Type", "Authorization", "X-Requested-With", "Cache-Control", "Pragma"],
  exposedHeaders: ["Content-Length"],
  optionsSuccessStatus: 204,
  maxAge: 86400,
};

module.exports = { corsOptions, getAllowedOrigins };
