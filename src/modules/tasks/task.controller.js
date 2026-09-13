const taskService = require('./task.service');

async function list(req, res, next) {
  try {
    const { projectId } = req.query;
    if (!projectId) {
      return res.status(400).json({ success: false, message: 'projectId query param is required' });
    }

    const tasks = await taskService.findAll(req.orgId, projectId);
    res.json({ success: true, tasks });
  } catch (err) {
    next(err);
  }
}

async function create(req, res, next) {
  try {
    const { projectId, title } = req.body;
    if (!projectId || !title) {
      return res.status(400).json({ success: false, message: 'projectId and title are required' });
    }

    const task = await taskService.create(req.orgId, { projectId, title });
    res.status(201).json({ success: true, task });
  } catch (err) {
    next(err);
  }
}

async function complete(req, res, next) {
  try {
    const task = await taskService.markDone(req.orgId, req.params.id);
    res.json({ success: true, task });
  } catch (err) {
    next(err);
  }
}

module.exports = { list, create, complete };