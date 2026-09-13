const { app, request, signupAndCreateOrg } = require('./helpers');
const { pool, adminPool } = require('../src/config/db');

describe('Tenant isolation (Row-Level Security)', () => {
  afterAll(async () => {
    await pool.end();
    await adminPool.end();
  });

  it('does not allow one organization to see another organization\'s projects', async () => {
    // Set up two completely independent tenants
    const orgA = await signupAndCreateOrg({ userName: 'Alice', orgName: 'Acme Corp' });
    const orgB = await signupAndCreateOrg({ userName: 'Bob', orgName: 'Globex Corp' });

    // Org A creates a project
    const createRes = await request(app)
      .post('/projects')
      .set('X-Org-Slug', orgA.slug)
      .set('Authorization', `Bearer ${orgA.accessToken}`)
      .send({ name: 'Confidential Acme Project' });

    expect(createRes.status).toBe(201);
    expect(createRes.body.success).toBe(true);

    // Org A can see its own project
    const orgAView = await request(app)
      .get('/projects')
      .set('X-Org-Slug', orgA.slug)
      .set('Authorization', `Bearer ${orgA.accessToken}`);

    expect(orgAView.body.projects).toHaveLength(1);
    expect(orgAView.body.projects[0].name).toBe('Confidential Acme Project');

    // Org B queries projects with ITS OWN valid token — must NOT see Org A's data.
    // This is the actual security guarantee: RLS enforces this at the database
    // layer, not application-level filtering.
    const orgBView = await request(app)
      .get('/projects')
      .set('X-Org-Slug', orgB.slug)
      .set('Authorization', `Bearer ${orgB.accessToken}`);

    expect(orgBView.status).toBe(200);
    expect(orgBView.body.projects).toHaveLength(0);
  });

  it('rejects a token used against a different organization than it was issued for', async () => {
    const orgA = await signupAndCreateOrg({ userName: 'Carol', orgName: 'Initech' });
    const orgB = await signupAndCreateOrg({ userName: 'Dave', orgName: 'Umbrella Corp' });

    // Try to use Org A's token but claim to be Org B via the header —
    // authMiddleware should catch this mismatch and reject it outright.
    const res = await request(app)
      .get('/projects')
      .set('X-Org-Slug', orgB.slug)
      .set('Authorization', `Bearer ${orgA.accessToken}`);

    expect(res.status).toBe(401);
    expect(res.body.message).toMatch(/does not belong to this organization/i);
  });
});