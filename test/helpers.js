const request = require('supertest');
const app = require('../src/app');

function uniqueSuffix() {
  return `${Date.now()}-${Math.floor(Math.random() * 100000)}`;
}

async function signupAndCreateOrg({ userName, orgName }) {
  const suffix = uniqueSuffix();
  const email = `${userName.toLowerCase()}-${suffix}@test.com`;
  const password = 'password123';
  const slug = `${orgName.toLowerCase().replace(/\s+/g, '-')}-${suffix}`;

  const signupRes = await request(app)
    .post('/auth/signup')
    .send({ name: userName, email, password });

  const identityToken = signupRes.body.identityToken;

  const orgRes = await request(app)
    .post('/organizations')
    .set('Authorization', `Bearer ${identityToken}`)
    .send({ name: orgName, slug });

  const orgId = orgRes.body.organization.id;

  const selectRes = await request(app)
    .post('/auth/select-organization')
    .set('Authorization', `Bearer ${identityToken}`)
    .send({ orgId });

  const accessToken = selectRes.body.accessToken;

  return { email, password, identityToken, orgId, slug, accessToken, role: selectRes.body.role };
}

async function loginAndSelectOrg({ email, password, orgId, slug }) {
  const loginRes = await request(app).post('/auth/login').send({ email, password });
  const identityToken = loginRes.body.identityToken;

  const selectRes = await request(app)
    .post('/auth/select-organization')
    .set('Authorization', `Bearer ${identityToken}`)
    .send({ orgId });

  return { identityToken, accessToken: selectRes.body.accessToken, role: selectRes.body.role };
}

module.exports = { app, request, uniqueSuffix, signupAndCreateOrg, loginAndSelectOrg };