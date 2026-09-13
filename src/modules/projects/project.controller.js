const projectService = require('./project.service');

async function list(req, res, next) {
  try {
    const projects = await projectService.findAll(req.orgId);
    res.json({ success: true, projects });
  } catch (err) {
    next(err);
  }
}

async function create(req, res, next) {
  try {
    const { name, description } = req.body;
    if (!name) return res.status(400).json({ success: false, message: 'name is required' });

    const project = await projectService.create(req.orgId, {
      name,
      description,
      createdBy: req.user.id,
    });
    res.status(201).json({ success: true, project });
  } catch (err) {
    next(err);
  }
}

module.exports = { list, create };