const { app, request, signupAndCreateOrg, loginAndSelectOrg, uniqueSuffix } = require('./helpers');
const { pool, adminPool } = require('../src/config/db');

describe('Role-based access control', () => {
  afterAll(async () => {
    await pool.end();
    await adminPool.end();
  });

  it('blocks a MEMBER from creating a project, but allows the OWNER', async () => {
    const owner = await signupAndCreateOrg({ userName: 'Owner', orgName: 'Wayne Enterprises' });

    // Sign up a separate user who will be invited as a plain MEMBER
    const suffix = uniqueSuffix();
    const memberEmail = `member-${suffix}@test.com`;
    const memberPassword = 'password123';

    await request(app)
      .post('/auth/signup')
      .send({ name: 'Member', email: memberEmail, password: memberPassword });

    const inviteRes = await request(app)
      .post('/organizations/members')
      .set('X-Org-Slug', owner.slug)
      .set('Authorization', `Bearer ${owner.accessToken}`)
      .send({ email: memberEmail, role: 'MEMBER' });

    expect(inviteRes.status).toBe(201);

    const member = await loginAndSelectOrg({
      email: memberEmail,
      password: memberPassword,
      orgId: owner.orgId,
      slug: owner.slug,
    });

    expect(member.role).toBe('MEMBER');

    // MEMBER should be blocked from creating a project
    const blockedRes = await request(app)
      .post('/projects')
      .set('X-Org-Slug', owner.slug)
      .set('Authorization', `Bearer ${member.accessToken}`)
      .send({ name: 'Should Not Be Created' });

    expect(blockedRes.status).toBe(403);

    // But MEMBER can still read
    const readRes = await request(app)
      .get('/projects')
      .set('X-Org-Slug', owner.slug)
      .set('Authorization', `Bearer ${member.accessToken}`);

    expect(readRes.status).toBe(200);

    // OWNER, meanwhile, should succeed at creating a project
    const ownerCreateRes = await request(app)
      .post('/projects')
      .set('X-Org-Slug', owner.slug)
      .set('Authorization', `Bearer ${owner.accessToken}`)
      .send({ name: 'Owner Created This' });

    expect(ownerCreateRes.status).toBe(201);
  });
});