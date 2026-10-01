import { beforeAll, beforeEach, describe, expect, it } from 'vitest';

import { AuthService } from './auth.service.js';
import { prisma, resetDatabase, clock } from '../../../test/harness.js';

const auth = new AuthService(prisma as never, clock);

beforeAll(async () => {
  await prisma.$connect();
});

beforeEach(async () => {
  await resetDatabase();
});

describe('UC01 — self-serve registration', () => {
  it('creates an account, issues one-time recovery codes, and starts a session', async () => {
    const { user, recoveryCodes, token } = await auth.signUp('alice', 'a-long-enough-password');

    expect(user.username).toBe('alice');
    expect(recoveryCodes.length).toBeGreaterThan(0);
    expect(token).toBeTruthy();

    // Only the hashes are kept — never the codes themselves (nothing to leak, BR28).
    const stored = await prisma.recoveryCode.findMany({ where: { userId: user.id } });
    expect(stored).toHaveLength(recoveryCodes.length);
    expect(stored.some((s) => recoveryCodes.includes(s.codeHash))).toBe(false);

    // The new account can immediately sign in with the same password.
    const back = await auth.signIn('alice', 'a-long-enough-password');
    expect(back.user.id).toBe(user.id);
  });

  it('rejects a taken username with DUPLICATE, not a 500', async () => {
    await auth.signUp('bob', 'a-long-enough-password');
    await expect(auth.signUp('bob', 'another-long-password')).rejects.toMatchObject({
      code: 'DUPLICATE',
    });
  });
});

describe('UC01 alt — recover access with a one-time code', () => {
  it('resets the password with a valid code and lets the new password sign in', async () => {
    const { recoveryCodes } = await auth.signUp('carol', 'the-original-password');
    const code = recoveryCodes[0]!;

    await auth.recover('carol', code, 'a-brand-new-password');

    // The new password works; the old one no longer does.
    const back = await auth.signIn('carol', 'a-brand-new-password');
    expect(back.token).toBeTruthy();
    await expect(auth.signIn('carol', 'the-original-password')).rejects.toThrow();
  });

  it('consumes the code — the same code cannot be used twice', async () => {
    const { recoveryCodes } = await auth.signUp('dave', 'the-original-password');
    const code = recoveryCodes[0]!;

    await auth.recover('dave', code, 'a-brand-new-password');
    await expect(auth.recover('dave', code, 'yet-another-password')).rejects.toThrow();
  });

  it('rejects a wrong code', async () => {
    await auth.signUp('erin', 'the-original-password');
    await expect(auth.recover('erin', 'NOT-A-REAL-CODE', 'a-brand-new-password')).rejects.toThrow();
  });
});
