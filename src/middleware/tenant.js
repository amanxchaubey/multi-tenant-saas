const { query } = require('../config/db');
const { redis, isRedisAvailable } = require('../config/redis');

async function tenantMiddleware(req, res, next) {
  try {
    const slug = resolveSlug(req);
    if (!slug) {
      return res.status(404).json({ success: false, message: 'Unable to determine organization for this request' });
    }

    const cacheKey = `org:slug:${slug}`;
    let org = null;

    // Cache is a pure optimization — if Redis is down or errors, just
    // skip straight to the database instead of failing the request.
    if (isRedisAvailable()) {
      try {
        const cached = await redis.get(cacheKey);
        if (cached) org = JSON.parse(cached);
      } catch {
        org = null; // fall through to the database below
      }
    }

    if (!org) {
      const { rows } = await query('SELECT id, slug, name FROM organizations WHERE slug = $1', [slug]);
      if (rows[0]) {
        org = rows[0];
        if (isRedisAvailable()) {
          redis.set(cacheKey, JSON.stringify(org), 'EX', 60).catch(() => {});
        }
      }
    }

    if (!org) {
      return res.status(404).json({ success: false, message: `No organization found for "${slug}"` });
    }

    req.orgId = org.id;
    req.orgSlug = org.slug;
    next();
  } catch (err) {
    next(err);
  }
}

function resolveSlug(req) {
  const headerSlug = req.header('x-org-slug');
  if (headerSlug) return headerSlug;

  const host = req.hostname || '';
  const parts = host.split('.');
  if (parts.length > 2) return parts[0];

  return undefined;
}

module.exports = tenantMiddleware;