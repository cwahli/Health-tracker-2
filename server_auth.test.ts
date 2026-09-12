import { describe, it, expect } from 'vitest';
import {
  hashPassword,
  generateSalt,
  signSessionToken,
  verifySessionToken,
  authenticateUser,
  registerUser,
  verifyFirebaseIdToken,
  ADMIN_CREDENTIALS
} from './server_auth.js';

describe('server_auth: Password and Session Token Security', () => {
  it('hashes passwords deterministically with given salt', () => {
    const salt = generateSalt();
    const hash1 = hashPassword('MySecretPass123!', salt);
    const hash2 = hashPassword('MySecretPass123!', salt);
    expect(hash1).toBe(hash2);
    expect(hash1.length).toBe(128); // 64 bytes in hex
  });

  it('different salts produce different hashes for same password', () => {
    const salt1 = generateSalt();
    const salt2 = generateSalt();
    const hash1 = hashPassword('MySecretPass123!', salt1);
    const hash2 = hashPassword('MySecretPass123!', salt2);
    expect(hash1).not.toBe(hash2);
  });

  it('signs and verifies session tokens correctly', () => {
    const token = signSessionToken({
      uid: 'user_123',
      email: 'user@example.com',
      nickname: 'TestUser',
      userType: 'Standard'
    });
    expect(token.startsWith('htk.')).toBe(true);

    const verified = verifySessionToken(token);
    expect(verified).not.toBeNull();
    expect(verified?.uid).toBe('user_123');
    expect(verified?.email).toBe('user@example.com');
    expect(verified?.nickname).toBe('TestUser');
    expect(verified?.userType).toBe('Standard');
  });

  it('rejects tampered or expired tokens', () => {
    const token = signSessionToken({
      uid: 'user_123',
      email: 'user@example.com'
    });
    const tampered = token + 'tampered';
    expect(verifySessionToken(tampered)).toBeNull();

    // Expired token
    const expiredToken = signSessionToken({
      uid: 'user_123',
      email: 'user@example.com',
      exp: Math.floor(Date.now() / 1000) - 100 // in the past
    });
    expect(verifySessionToken(expiredToken)).toBeNull();
  });
});

describe('server_auth: Admin Account Pre-configuration', () => {
  it('authenticates admin cwah.liu@gmail.com with exact UID and role', async () => {
    const res = await authenticateUser('cwah.liu@gmail.com', 'Admin135$,');
    expect(res.success).toBe(true);
    expect(res.user?.uid).toBe(ADMIN_CREDENTIALS.uid);
    expect(res.user?.uid).toBe('hiJun2hTdDTk2igwerun2LKvwb42');
    expect(res.user?.email).toBe('cwah.liu@gmail.com');
    expect(res.user?.userType).toBe('Admin');
    expect(res.token).toBeDefined();

    const verified = verifySessionToken(res.token!);
    expect(verified?.uid).toBe('hiJun2hTdDTk2igwerun2LKvwb42');
  });

  it('rejects admin login with incorrect password', async () => {
    const res = await authenticateUser('cwah.liu@gmail.com', 'WrongPass123!');
    expect(res.success).toBe(false);
    expect(res.error).toBe('Invalid email or password');
  });

  it('prevents registering duplicate over admin account', async () => {
    const res = await registerUser('cwah.liu@gmail.com', 'SomeNewPass123!');
    expect(res.success).toBe(false);
    expect(res.error).toContain('already registered');
  });
});

describe('server_auth: Standard User Registration and Login', () => {
  it('registers a new user and authenticates successfully', async () => {
    const uniqueEmail = `test_user_${Date.now()}@healthcockpit.com`;
    const regRes = await registerUser(uniqueEmail, 'SecurePass123$', 'Alice');
    expect(regRes.success).toBe(true);
    expect(regRes.user?.email).toBe(uniqueEmail);
    expect(regRes.user?.nickname).toBe('Alice');
    expect(regRes.token).toBeDefined();

    const loginRes = await authenticateUser(uniqueEmail, 'SecurePass123$');
    expect(loginRes.success).toBe(true);
    expect(loginRes.user?.email).toBe(uniqueEmail);
    expect(loginRes.user?.nickname).toBe('Alice');
  });
});

describe('server_auth: verifyFirebaseIdToken bearer resolution', () => {
  it('resolves signed session token in verifyFirebaseIdToken', async () => {
    const token = signSessionToken({
      uid: 'hiJun2hTdDTk2igwerun2LKvwb42',
      email: 'cwah.liu@gmail.com'
    });
    const fakeReq = {
      headers: {
        authorization: `Bearer ${token}`,
        host: 'health-tracker.pages.dev'
      }
    };
    const identity = await verifyFirebaseIdToken(fakeReq);
    expect(identity.uid).toBe('hiJun2hTdDTk2igwerun2LKvwb42');
    expect(identity.email).toBe('cwah.liu@gmail.com');
  });
});
