"use client";

import { useQueryClient } from "@tanstack/react-query";
import { clearOfflineData } from "./offline";
import type { LoginInput, Me, RegisterInput } from "@triply/shared";
import { useCallback } from "react";
import { api } from "./api/client";
import { keys, useMe } from "./api/queries";
import { getSocket } from "./realtime";

/** Auth actions. Cookies are HTTP-only, so the client only ever knows "who am I". */
export function useSession() {
  const qc = useQueryClient();
  const me = useMe();

  const login = useCallback(
    async (input: LoginInput) => {
      const user = await api.post<Me>("/auth/login", input);
      qc.clear();
      qc.setQueryData(keys.me, user);
      return user;
    },
    [qc],
  );

  const register = useCallback(
    async (input: RegisterInput) => {
      const user = await api.post<Me>("/auth/register", input);
      qc.clear();
      qc.setQueryData(keys.me, user);
      return user;
    },
    [qc],
  );

  const logout = useCallback(async () => {
    await api.post("/auth/logout").catch(() => undefined);
    clearOfflineData();
    getSocket(null);
    qc.clear();
    qc.setQueryData(keys.me, null);
  }, [qc]);

  return { me: me.data ?? null, loading: me.isLoading, login, register, logout };
}
