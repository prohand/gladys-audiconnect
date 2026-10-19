import { test } from 'node:test';
import assert from 'node:assert/strict';
import { AudiAuthError, AudiSession } from '../src/audi/auth.js';
import { useFakeAudi } from './helpers/fakeAudi.js';

test('the device login gives the Audi page and its code', async (t) => {
  const fake = useFakeAudi(t);
  const session = new AudiSession({ market: 'DE' });
  const login = await session.startDeviceLogin();
  assert.equal(login.url, 'https://identity.vwgroup.io/device?user_code=ABCD-EFGH');
  assert.equal(login.userCode, 'ABCD-EFGH');
  assert.equal(login.intervalMs, 5000);
  const [request] = fake.callsTo('/device_authorization');
  assert.equal(request.body.scope, 'openid mbb profile badge cars dealers vin');
  assert.equal(request.body.client_id, '09b6cbec-cd19-4589-82fd-363dfa8c24da@apps_vw-dilab_com');
});

test('polling waits for the approval, then holds the tokens and hands out the refresh token', async (t) => {
  useFakeAudi(t);
  const stored = [];
  const session = new AudiSession({ onRefreshToken: (token) => stored.push(token) });
  const { deviceCode } = await session.startDeviceLogin();
  assert.equal(await session.pollDeviceLogin(deviceCode), 'pending');
  assert.equal(session.linked, false);
  assert.equal(await session.pollDeviceLogin(deviceCode), 'ok');
  assert.equal(session.linked, true);
  assert.deepEqual(stored, ['idk-refresh-1']);
  assert.equal(await session.bffToken(), 'idk-access-1');
  assert.equal(await session.azsToken(), 'azs-idk-access-1');
});

test('slow_down, expiry and refusal are told apart', async (t) => {
  const fake = useFakeAudi(t);
  fake.deviceCodeSteps = ['slow_down', 'expired_token', 'access_denied'];
  const session = new AudiSession();
  assert.equal(await session.pollDeviceLogin('code'), 'slow_down');
  assert.equal(await session.pollDeviceLogin('code'), 'expired');
  assert.equal(await session.pollDeviceLogin('code'), 'denied');
});

test('a restart signs in again with the stored refresh token, which rotates', async (t) => {
  useFakeAudi(t);
  const stored = [];
  let clock = 0;
  const session = new AudiSession({
    onRefreshToken: (token) => stored.push(token),
    now: () => clock,
  });
  await session.loginWithRefreshToken('idk-refresh-0');
  assert.deepEqual(stored, ['idk-refresh-1']);

  // One hour later, the access token is about to expire: one refresh, even
  // for two cars read at the same time.
  clock = 56 * 60 * 1000;
  const [a, b] = await Promise.all([session.bffToken(), session.bffToken()]);
  assert.equal(a, 'idk-access-2');
  assert.equal(b, 'idk-access-2');
  assert.deepEqual(stored, ['idk-refresh-1', 'idk-refresh-2']);
});

test('a refused refresh token asks for a new link', async (t) => {
  useFakeAudi(t);
  const session = new AudiSession();
  await assert.rejects(session.loginWithRefreshToken('revoked'), AudiAuthError);
  assert.equal(session.linked, false);
  await assert.rejects(session.loginWithRefreshToken(''), AudiAuthError);
});

test('a transient refresh failure is not a lost link', async (t) => {
  const fake = useFakeAudi(t);
  fake.refreshError = 'temporarily_unavailable';
  const session = new AudiSession();
  await assert.rejects(
    session.loginWithRefreshToken('idk-refresh-0'),
    (err) => !(err instanceof AudiAuthError),
  );
});

test('the lock token is fetched once, from the id token', async (t) => {
  const fake = useFakeAudi(t);
  const session = new AudiSession();
  await session.loginWithRefreshToken('idk-refresh-0');
  assert.equal(await session.mbbToken(), 'mbb-idk-id-1');
  assert.equal(await session.mbbToken(), 'mbb-idk-id-1');
  assert.equal(fake.callsTo('/mobile/register/v1').length, 1);
  assert.equal(session.mbbClientId, 'mbb-client-1');
});
