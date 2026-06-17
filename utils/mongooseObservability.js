const mongoose = require('mongoose');
const logger = require('./logger');

let installed = false;

const installMongooseObservability = () => {
  if (installed) return;
  installed = true;

  const originalExec = mongoose.Query.prototype.exec;
  const slowQueryMs = Number(process.env.SLOW_QUERY_MS || 250);

  mongoose.Query.prototype.exec = async function observedExec(...args) {
    const startedAt = process.hrtime.bigint();

    try {
      return await originalExec.apply(this, args);
    } finally {
      const durationMs = Number(process.hrtime.bigint() - startedAt) / 1e6;
      if (durationMs >= slowQueryMs) {
        logger.warn('Slow Mongo query', {
          model: this.model?.modelName,
          operation: this.op,
          durationMs: Math.round(durationMs),
          query: this.getQuery(),
          projection: this.projection()
        });
      }
    }
  };
};

module.exports = { installMongooseObservability };
