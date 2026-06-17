const summaryCache = new Map();
const SUMMARY_CACHE_TTL_MS = 3 * 1000;

const getSummaryCacheKey = (userId) => `summary:${String(userId)}`;

const readSummaryCache = (userId) => {
  const key = getSummaryCacheKey(userId);
  const cached = summaryCache.get(key);
  if (!cached) return null;
  if (Date.now() - cached.timestamp > SUMMARY_CACHE_TTL_MS) {
    summaryCache.delete(key);
    return null;
  }
  return cached.data;
};

const writeSummaryCache = (userId, data) => {
  summaryCache.set(getSummaryCacheKey(userId), { data, timestamp: Date.now() });
  if (summaryCache.size > 500) {
    const oldestKey = summaryCache.keys().next().value;
    summaryCache.delete(oldestKey);
  }
};

const invalidateSummaryCache = (userId) => {
  if (!userId) return;
  summaryCache.delete(getSummaryCacheKey(userId));
};

module.exports = {
  SUMMARY_CACHE_TTL_MS,
  readSummaryCache,
  writeSummaryCache,
  invalidateSummaryCache,
};
