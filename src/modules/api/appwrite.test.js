import { describe, it, expect, vi } from 'vitest';
import { APPWRITE_CONFIG, account, tablesDB, getCurrentUser, logout } from './appwrite.js';

// Mock appwrite SDK
vi.mock('appwrite', () => {
    return {
        Client: class {
            setEndpoint() { return this; }
            setProject() { return this; }
        },
        Account: class {
            get = vi.fn();
            deleteSession = vi.fn();
        },
        TablesDB: class {},
        ID: { unique: () => '123' }
    };
});

describe('Appwrite Module', () => {
    it('should export configuration', () => {
        expect(APPWRITE_CONFIG.ENDPOINT).toBe('https://nyc.cloud.appwrite.io/v1');
    });

    describe('getCurrentUser', () => {
        it('should return user if logged in', async () => {
            const mockUser = { $id: 'user1', name: 'Test' };
            account.get.mockResolvedValueOnce(mockUser);

            const result = await getCurrentUser();
            expect(result).toEqual(mockUser);
        });

        it('should return null if not logged in or error', async () => {
            account.get.mockRejectedValueOnce(new Error('Not logged in'));

            const result = await getCurrentUser();
            expect(result).toBeNull();
        });
    });

    describe('logout', () => {
        it('should return true on successful logout', async () => {
            account.deleteSession.mockResolvedValueOnce({});

            const result = await logout();
            expect(result).toBe(true);
        });

        it('should log error and return false on failure', async () => {
            account.deleteSession.mockRejectedValueOnce(new Error('Logout failed'));
            const consoleSpy = vi.spyOn(console, 'error').mockImplementation(() => {});

            const result = await logout();
            expect(result).toBe(false);
            expect(consoleSpy).toHaveBeenCalled();

            consoleSpy.mockRestore();
        });
    });
});
