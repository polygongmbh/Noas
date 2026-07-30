import { afterEach, describe, expect, it } from 'vitest';
import { clearAuthSession, persistAuthSession, readAuthSession } from '../src/lib/session';

describe('session', () => {
  afterEach(() => {
    clearAuthSession();
  });

  it('returns null when nothing is stored', () => {
    expect(readAuthSession()).toBeNull();
  });

  it('round-trips a persisted session, normalizing case', () => {
    persistAuthSession({ username: 'Alice', password: 'hunter2', passwordHash: 'ABCDEF' });

    expect(readAuthSession()).toEqual({
      username: 'alice',
      password: 'hunter2',
      password_hash: 'abcdef',
    });
  });

  it('clears the stored session', () => {
    persistAuthSession({ username: 'alice', password: 'x', passwordHash: 'y' });
    clearAuthSession();
    expect(readAuthSession()).toBeNull();
  });
});
