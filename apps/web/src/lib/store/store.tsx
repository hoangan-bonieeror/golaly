"use client";

/**
 * Prototype store — wraps the mock API with React state.
 *
 * - DB persists in localStorage so the prototype survives reloads.
 * - The "signed in" user is per-tab (sessionStorage): open two tabs as two
 *   demo users and edits sync across tabs via the `storage` event —
 *   a stand-in for the planned WebSocket events (spec §31).
 */
import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from "react";
import * as api from "../mock/api";
import { createSeed, type DB, DEMO_USER_IDS } from "../mock/seed";

const DB_KEY = "triply.prototype.db.v2";
const ME_KEY = "triply.prototype.me";

type Api = typeof api;
type Mutator<K extends keyof Api> = Api[K] extends (db: DB, me: string | null, ...args: infer A) => infer R
  ? (...args: A) => ([R] extends [void] ? true : R) | undefined
  : never;
type MutationKeys =
  | "createTrip" | "updateTrip" | "deleteTrip" | "addDay" | "addItem" | "updateItem" | "deleteItem"
  | "duplicateItem" | "reorderItem" | "createInvitation" | "revokeInvitation" | "acceptInvitation"
  | "rejectInvitation" | "changeRole" | "removeMember" | "forkTrip" | "toggleSaveTrip" | "toggleSavePost"
  | "toggleSavePlace" | "toggleLike" | "addComment" | "deleteComment" | "toggleFollow" | "createPost"
  | "report" | "markRead" | "markAllRead" | "register" | "updateProfile";
export type Actions = { [K in MutationKeys]: Mutator<K> };

interface Toast {
  id: number;
  text: string;
  tone: "ok" | "error";
}

interface StoreValue {
  db: DB;
  me: string | null;
  ready: boolean;
  actions: Actions;
  signIn: (userId: string) => void;
  signOut: () => void;
  resetDemo: () => void;
  toast: (text: string, tone?: Toast["tone"]) => void;
  toasts: Toast[];
}

const Ctx = createContext<StoreValue | null>(null);

function load(): DB {
  try {
    const raw = localStorage.getItem(DB_KEY);
    if (raw) return JSON.parse(raw) as DB;
  } catch {
    /* ignore corrupt storage */
  }
  return createSeed();
}

export function StoreProvider({ children }: { children: React.ReactNode }) {
  const [db, setDb] = useState<DB>(() => createSeed());
  const [me, setMe] = useState<string | null>(DEMO_USER_IDS.an);
  const [ready, setReady] = useState(false);
  const [toasts, setToasts] = useState<Toast[]>([]);
  const dbRef = useRef(db);
  const meRef = useRef(me);

  useEffect(() => {
    const loaded = load();
    dbRef.current = loaded;
    setDb(loaded);
    try {
      const stored = sessionStorage.getItem(ME_KEY);
      const id = stored === null ? DEMO_USER_IDS.an : stored === "" ? null : stored;
      meRef.current = id;
      setMe(id);
    } catch {
      /* noop */
    }
    setReady(true);

    const onStorage = (e: StorageEvent) => {
      if (e.key === DB_KEY && e.newValue) {
        const next = JSON.parse(e.newValue) as DB;
        dbRef.current = next;
        setDb(next);
      }
    };
    window.addEventListener("storage", onStorage);
    return () => window.removeEventListener("storage", onStorage);
  }, []);

  const toast = useCallback((text: string, tone: Toast["tone"] = "ok") => {
    const id = Date.now() + Math.random();
    setToasts((t) => [...t, { id, text, tone }]);
    setTimeout(() => setToasts((t) => t.filter((x) => x.id !== id)), 3200);
  }, []);

  const commit = useCallback((next: DB) => {
    dbRef.current = next;
    setDb(next);
    try {
      localStorage.setItem(DB_KEY, JSON.stringify(next));
    } catch {
      /* storage full / disabled — keep in memory */
    }
  }, []);

  const actions = useMemo(() => {
    const keys: MutationKeys[] = [
      "createTrip", "updateTrip", "deleteTrip", "addDay", "addItem", "updateItem", "deleteItem",
      "duplicateItem", "reorderItem", "createInvitation", "revokeInvitation", "acceptInvitation",
      "rejectInvitation", "changeRole", "removeMember", "forkTrip", "toggleSaveTrip", "toggleSavePost",
      "toggleSavePlace", "toggleLike", "addComment", "deleteComment", "toggleFollow", "createPost",
      "report", "markRead", "markAllRead", "register", "updateProfile",
    ];
    const out = {} as Record<string, unknown>;
    for (const k of keys) {
      out[k] = (...args: unknown[]) => {
        const draft = structuredClone(dbRef.current);
        try {
          const fn = api[k] as (db: DB, me: string | null, ...a: unknown[]) => unknown;
          const result = fn(draft, meRef.current, ...args);
          commit(draft);
          return result ?? true; // void mutations report success as `true`
        } catch (e) {
          // Friendly errors only — never surface raw internals (spec §40).
          const msg = e instanceof api.ApiError ? e.message : "Something went wrong. Please try again.";
          toast(msg, "error");
          return undefined;
        }
      };
    }
    return out as Actions;
  }, [commit, toast]);

  const signIn = useCallback((userId: string) => {
    meRef.current = userId;
    setMe(userId);
    try {
      sessionStorage.setItem(ME_KEY, userId);
    } catch {}
  }, []);

  const signOut = useCallback(() => {
    meRef.current = null;
    setMe(null);
    try {
      sessionStorage.setItem(ME_KEY, "");
    } catch {}
  }, []);

  const resetDemo = useCallback(() => {
    commit(createSeed());
    toast("Demo data reset");
  }, [commit, toast]);

  const value = useMemo(
    () => ({ db, me, ready, actions, signIn, signOut, resetDemo, toast, toasts }),
    [db, me, ready, actions, signIn, signOut, resetDemo, toast, toasts],
  );
  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

export function useStore() {
  const v = useContext(Ctx);
  if (!v) throw new Error("useStore must be used inside <StoreProvider>");
  return v;
}

export function useMe() {
  const { db, me } = useStore();
  return me ? db.users.find((u) => u.id === me) ?? null : null;
}
