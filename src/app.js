const express = require('express');
const { Sentry } = require('./config/sentry');
const tenantMiddleware = require('./middleware/tenant');
const authMiddleware = require('./middleware/auth');
const errorHandler = require('./middleware/errorHandler');
const requestLogger = require('./middleware/requestLogger');
const { authLimiter, generalLimiter } = require('./middleware/rateLimiter');

const authRoutes = require('./modules/auth/auth.routes');
const organizationRoutes = require('./modules/organizations/organization.routes');
const projectRoutes = require('./modules/projects/project.routes');
const taskRoutes = require('./modules/tasks/task.routes');

const app = express();

app.use(express.json());
app.use(requestLogger);
app.use(generalLimiter);





app.get('/', (req, res) => {
  res.json({
    message: 'Multi-tenant SaaS backend — API only, no frontend UI',
    docs: 'See README for full endpoint list and setup instructions',
    health: '/health',
  });
});

app.get('/health', (req, res) => res.json({ success: true, status: 'ok' }));

app.use('/organizations', organizationRoutes);
app.use('/auth', authLimiter, authRoutes);
app.use('/projects', tenantMiddleware, authMiddleware, projectRoutes);
app.use('/tasks', tenantMiddleware, authMiddleware, taskRoutes);

// Sentry needs to see errors BEFORE your own error handler responds and
// swallows them — this line reports every unhandled error to Sentry,
// then passes it along to errorHandler as normal.
Sentry.setupExpressErrorHandler(app);

app.use(errorHandler);

module.exports = app;