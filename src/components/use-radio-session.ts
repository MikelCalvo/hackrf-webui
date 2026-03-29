"use client";

import { useCallback, useEffect, useRef, useState } from "react";

import {
  createRadioSession,
  listRadioSessions,
  stopRadioSession,
  updateRadioSession,
} from "@/lib/radio-session-client";
import type {
  CreateRadioSessionRequest,
  RadioSessionEvent,
  RadioSessionModule,
  RadioSessionSnapshot,
  RadioSessionSnapshotForModule,
  UpdateRadioSessionRequest,
  UpdateRadioSessionRequestForModule,
} from "@/lib/radio-session";

type UseRadioSessionHandlers = {
  onActivity?: (event: Extract<RadioSessionEvent, { type: "activity" }>) => void;
  onSessionError?: (event: Extract<RadioSessionEvent, { type: "session-error" }>) => void;
};

function isSessionForModule<M extends RadioSessionModule>(
  session: RadioSessionSnapshot,
  module: M,
): session is RadioSessionSnapshotForModule<M> {
  return session.module === module;
}

export function useRadioSession<M extends RadioSessionModule>(
  module: M,
  handlers: UseRadioSessionHandlers = {},
): {
  session: RadioSessionSnapshotForModule<M> | null;
  error: string;
  createSession: (payload: CreateRadioSessionRequest) => Promise<RadioSessionSnapshotForModule<M>>;
  stopSession: () => Promise<void>;
  updateSession: (payload: UpdateRadioSessionRequestForModule<M>) => Promise<RadioSessionSnapshotForModule<M>>;
  refresh: () => Promise<void>;
} {
  const [session, setSession] = useState<RadioSessionSnapshotForModule<M> | null>(null);
  const [error, setError] = useState("");

  const handlersRef = useRef(handlers);
  const eventSourceRef = useRef<EventSource | null>(null);
  const sessionIdRef = useRef<string | null>(null);
  const attachRef = useRef<(sessionId: string | null) => void>(() => {});
  const reconnectTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const findModuleSession = useCallback(
    (
      sessions: RadioSessionSnapshot[],
    ): RadioSessionSnapshotForModule<M> | null =>
      (sessions.find(
        (entry): entry is RadioSessionSnapshotForModule<M> => isSessionForModule(entry, module),
      ) ?? null),
    [module],
  );

  useEffect(() => {
    handlersRef.current = handlers;
  }, [handlers]);

  const detach = useCallback(() => {
    eventSourceRef.current?.close();
    eventSourceRef.current = null;
    if (reconnectTimerRef.current) {
      clearTimeout(reconnectTimerRef.current);
      reconnectTimerRef.current = null;
    }
  }, []);

  const attach = useCallback((sessionId: string | null) => {
    if (!sessionId) {
      sessionIdRef.current = null;
      detach();
      return;
    }

    if (sessionIdRef.current === sessionId && eventSourceRef.current) {
      return;
    }

    detach();
    sessionIdRef.current = sessionId;

    const source = new EventSource(`/api/radio/sessions/${encodeURIComponent(sessionId)}/events`);
    eventSourceRef.current = source;

    source.addEventListener("snapshot", (event) => {
      const payload = JSON.parse((event as MessageEvent<string>).data) as RadioSessionSnapshot;
      if (!isSessionForModule(payload, module)) {
        return;
      }
      setSession(payload);
      setError("");
    });

    source.addEventListener("activity", (event) => {
      const payload = JSON.parse((event as MessageEvent<string>).data) as Extract<RadioSessionEvent, { type: "activity" }>;
      if (!isSessionForModule(payload.snapshot, module)) {
        return;
      }
      setSession(payload.snapshot);
      setError("");
      handlersRef.current.onActivity?.(payload);
    });

    source.addEventListener("session-error", (event) => {
      const payload = JSON.parse((event as MessageEvent<string>).data) as Extract<RadioSessionEvent, { type: "session-error" }>;
      if (!isSessionForModule(payload.snapshot, module)) {
        return;
      }
      setSession(payload.snapshot);
      setError(payload.message);
      handlersRef.current.onSessionError?.(payload);
    });

    source.onerror = () => {
      if (sessionIdRef.current !== sessionId) {
        return;
      }
      if (source.readyState === EventSource.CLOSED) {
        detach();
        reconnectTimerRef.current = setTimeout(() => {
          reconnectTimerRef.current = null;
          void listRadioSessions()
            .then((sessions) => {
              const nextSession = findModuleSession(sessions);
              setSession(nextSession);
              setError(nextSession?.lastError ?? "");
              attachRef.current(nextSession?.id ?? null);
            })
            .catch((error) => {
              setError(error instanceof Error ? error.message : "Could not refresh radio session.");
            });
        }, 1000);
      }
    };
  }, [detach, findModuleSession, module]);

  useEffect(() => {
    attachRef.current = attach;
  }, [attach]);

  const refresh = useCallback(async () => {
    const sessions = await listRadioSessions();
    const nextSession = findModuleSession(sessions);
    setSession(nextSession);
    setError(nextSession?.lastError ?? "");
    attach(nextSession?.id ?? null);
  }, [attach, findModuleSession]);

  const createSessionAndAttach = useCallback(async (payload: CreateRadioSessionRequest) => {
    const nextSession = await createRadioSession(payload) as RadioSessionSnapshotForModule<M>;
    setSession(nextSession);
    setError(nextSession.lastError ?? "");
    attach(nextSession.id);
    return nextSession;
  }, [attach]);

  const stopManagedSession = useCallback(async () => {
    const sessionId = sessionIdRef.current;
    if (!sessionId) {
      setSession(null);
      setError("");
      detach();
      return;
    }

    await stopRadioSession(sessionId);
    setSession(null);
    setError("");
    detach();
    sessionIdRef.current = null;
  }, [detach]);

  const patchManagedSession = useCallback(async (payload: UpdateRadioSessionRequestForModule<M>) => {
    const sessionId = sessionIdRef.current;
    if (!sessionId) {
      throw new Error("Radio session is not running.");
    }

    const nextSession = await updateRadioSession(sessionId, payload as UpdateRadioSessionRequest);
    if (!isSessionForModule(nextSession, module)) {
      throw new Error("Radio session returned an unexpected module snapshot.");
    }
    setSession(nextSession);
    setError(nextSession.lastError ?? "");
    attach(nextSession.id);
    return nextSession;
  }, [attach, module]);

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      try {
        const sessions = await listRadioSessions();
        if (cancelled) {
          return;
        }
        const nextSession = findModuleSession(sessions);
        setSession(nextSession);
        setError(nextSession?.lastError ?? "");
        attach(nextSession?.id ?? null);
      } catch (error) {
        if (!cancelled) {
          setError(error instanceof Error ? error.message : "Could not load radio sessions.");
        }
      }
    })();

    return () => {
      cancelled = true;
      detach();
    };
  }, [attach, detach, findModuleSession]);

  return {
    session,
    error,
    createSession: createSessionAndAttach,
    stopSession: stopManagedSession,
    updateSession: patchManagedSession,
    refresh,
  };
}
