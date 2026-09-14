const Redis = require('ioredis');

const redis = new Redis(process.env.REDIS_URL || 'redis://localhost:6379', {
  // Don't let Redis commands hang forever or endlessly retry — if it's
  // unreachable, fail fast so calling code can fall back to the database
  // instead of blocking every request.
  maxRetriesPerRequest: 1,
  retryStrategy: () => null, // stop retrying after the first failed connection attempt
  lazyConnect: true,
});

let isAvailable = true;

redis.on('error', (err) => {
  if (isAvailable) {
    console.warn('Redis unavailable, continuing without caching:', err.message);
    isAvailable = false;
  }
});

redis.on('connect', () => {
  isAvailable = true;
});

// Fire the initial connection attempt without blocking app startup.
redis.connect().catch(() => {
  console.warn('Redis not reachable at startup — app will run without caching.');
});

function isRedisAvailable() {
  return isAvailable;
}

module.exports = { redis, isRedisAvailable };