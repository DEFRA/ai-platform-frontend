// Runs before every test file. The frontend's own app-only token comes from a
// call to Entra, which a test must never make; every other part of
// access-token.js (the person's token, its refresh, the session) is the real
// code. access-token.test.js turns this off to test getAppToken itself.
vi.mock('#/server/common/helpers/access-token.js', async (importOriginal) => ({
  ...(await importOriginal()),
  getAppToken: vi.fn(async () => 'app-access-token')
}))
