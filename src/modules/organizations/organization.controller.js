const organizationService = require('./organization.service');

async function create(req, res, next) {
  try {
    const { name, slug } = req.body;
    if (!name || !slug) {
      return res.status(400).json({ success: false, message: 'name and slug are required' });
    }

    const organization = await organizationService.createOrganization({
      name,
      slug,
      userId: req.userId,
    });

    res.status(201).json({ success: true, organization });
  } catch (err) {
    next(err);
  }
}

async function listMine(req, res, next) {
  try {
    const organizations = await organizationService.listMyOrganizations(req.userId);
    res.json({ success: true, organizations });
  } catch (err) {
    next(err);
  }
}

async function getMine(req, res, next) {
  try {
    const org = await organizationService.getOrganization(req.orgId);
    res.json({ success: true, organization: org });
  } catch (err) {
    next(err);
  }
}

async function inviteMember(req, res, next) {
  try {
    const { email, role } = req.body;
    if (!email) return res.status(400).json({ success: false, message: 'email is required' });

    const membership = await organizationService.inviteMember(req.orgId, { email, role });
    res.status(201).json({ success: true, membership });
  } catch (err) {
    next(err);
  }
}

module.exports = { create, listMine, getMine, inviteMember };
