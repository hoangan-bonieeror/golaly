"use client";

import { useEffect } from "react";

/**
 * Title for pages whose name comes from data (a trip, a profile, a post). Static routes set theirs
 * with `metadata` in a layout instead. Keeps the "· Golaly" suffix of the root title template.
 */
export function useDocumentTitle(title: string | null | undefined) {
  useEffect(() => {
    if (title) document.title = `${title} · Golaly`;
  }, [title]);
}
