import { QueryClient } from '@tanstack/query-core';

export const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      staleTime: Infinity, // Data never goes stale, no automatic background refetching
      gcTime: 1000 * 60 * 60 * 24, // Keep in cache for 24 hours
      retry: 2, // Retry failed requests twice
      refetchOnWindowFocus: false, // Prevent unnecessary DB reads when switching tabs
    },
  },
});
