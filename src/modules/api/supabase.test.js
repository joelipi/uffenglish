import { describe, it, expect, vi, beforeEach } from 'vitest';

const { mockGetUser, mockSignOut } = vi.hoisted(() => ({
  mockGetUser: vi.fn(),
  mockSignOut: vi.fn(),
}));

vi.mock('@supabase/supabase-js', () => ({
  createClient: vi.fn(() => ({
    auth: {
      getUser: mockGetUser,
      getSession: vi.fn().mockResolvedValue({ data: { session: null } }),
      signOut: mockSignOut,
      signUp: vi.fn(),
      signInWithPassword: vi.fn(),
      updateUser: vi.fn(),
      resetPasswordForEmail: vi.fn(),
    },
    from: vi.fn(() => ({ select: vi.fn().mockReturnThis(), eq: vi.fn().mockReturnThis(), single: vi.fn(), insert: vi.fn(), upsert: vi.fn() })),
    storage: { from: vi.fn(() => ({ upload: vi.fn(), getPublicUrl: vi.fn(), remove: vi.fn() })) },
  })),
}));

import { SUPABASE_CONFIG, getCurrentUser, logout } from './supabase.js';

describe('Supabase Module', () => {
  beforeEach(() => vi.clearAllMocks());

  it('should export configuration', () => {
    expect(SUPABASE_CONFIG.URL).toBe('https://jbrbmbmupjfangqvaevx.supabase.co');
  });

  describe('getCurrentUser', () => {
    it('should return mapped user if logged in', async () => {
      mockGetUser.mockResolvedValueOnce({ data: { user: { id: 'user1', email: 'a@b.com', user_metadata: { full_name: 'Test' }, created_at: '2024-01-01' } }, error: null });
      const result = await getCurrentUser();
      expect(result.$id).toBe('user1');
      expect(result.email).toBe('a@b.com');
    });

    it('should return null if not logged in or error', async () => {
      mockGetUser.mockResolvedValueOnce({ data: { user: null }, error: null });
      const result = await getCurrentUser();
      expect(result).toBeNull();
    });
  });

  describe('logout', () => {
    it('should return true on successful logout', async () => {
      mockSignOut.mockResolvedValueOnce({ error: null });
      const result = await logout();
      expect(result).toBe(true);
    });

    it('should log error and return false on failure', async () => {
      mockSignOut.mockResolvedValueOnce({ error: new Error('fail') });
      const consoleSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
      const result = await logout();
      expect(result).toBe(false);
      expect(consoleSpy).toHaveBeenCalled();
      consoleSpy.mockRestore();
    });
  });
});
