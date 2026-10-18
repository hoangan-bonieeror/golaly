"use client";

import { hydrate, useQueryClient, type DehydratedState } from "@tanstack/react-query";
import { useState } from "react";

/**
 * Puts server-prefetched queries (lib/api/server.ts) into the client cache — once, and only queries the cache
 * doesn't have yet. Unlike <HydrationBoundary>, a later render with an older server copy (a soft navigation that
 * re-renders the page on the server) can never overwrite fresher data the client has since fetched.
 */
export function Prefetched({ state, children }: { state: DehydratedState | null; children: React.ReactNode }) {
  const qc = useQueryClient();
  useState(() => {
    if (!state) return;
    const missing = state.queries.filter((q) => qc.getQueryState(q.queryKey)?.data === undefined);
    if (missing.length) hydrate(qc, { ...state, queries: missing });
  });
  return children;
}
