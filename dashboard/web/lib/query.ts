import { QueryClient, isServer } from "@tanstack/react-query";

// Data-fetch cadence (PRD §9.2):
//   live (positions/summary) → 10s ; static JSON files → 30s + refetch on focus.
export const LIVE_INTERVAL = 10_000;
export const FILE_INTERVAL = 30_000;

function makeQueryClient() {
  return new QueryClient({
    defaultOptions: {
      queries: {
        staleTime: 5_000,
        refetchOnWindowFocus: true,
        retry: 1,
      },
    },
  });
}

let browserQueryClient: QueryClient | undefined;

// One client per request on the server, one shared client in the browser.
export function getQueryClient(): QueryClient {
  if (isServer) return makeQueryClient();
  if (!browserQueryClient) browserQueryClient = makeQueryClient();
  return browserQueryClient;
}
