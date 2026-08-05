import { useEffect, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { deskApi } from "@/api/deskApi";
import {
  listenToOperatorAuth,
  operatorAuthAvailable,
  signInOperator,
  signOutOperator,
  type OperatorUser
} from "@/api/operatorAuth";
import { deskKeys } from "@/hooks/useDesk";
import type { DeskOperatorCommandInput, DeskOperatorScope, DeskSession } from "@/types";

type OperatorAuthState = {
  status: "loading" | "ready" | "signed_out" | "unavailable" | "error";
  email: string | null;
  message: string | null;
};

const operatorKeys = {
  state: (scope: DeskOperatorScope) => ["desk-operator-state", scope.session, scope.strategyId, scope.tradingDate, scope.mode] as const
};

function deskOperatorScope(session: DeskSession): DeskOperatorScope {
  return {
    session: session.id,
    strategyId: session.strategyId,
    tradingDate: session.date,
    mode: String(session.mode).toLowerCase() === "paper" ? "paper" : "live"
  };
}

export function useOperatorState(session: DeskSession) {
  const scope = deskOperatorScope(session);
  return useQuery({
    queryKey: operatorKeys.state(scope),
    queryFn: () => deskApi.getOperatorState(scope),
    staleTime: 5_000,
    refetchInterval: 15_000,
    retry: 1
  });
}

export function useOperatorCommand(session: DeskSession) {
  const queryClient = useQueryClient();
  const scope = deskOperatorScope(session);
  return useMutation({
    mutationFn: (input: Omit<DeskOperatorCommandInput, keyof DeskOperatorScope>) => deskApi.executeOperatorCommand({ ...scope, ...input }),
    onSuccess: async result => {
      queryClient.setQueryData(operatorKeys.state(scope), result.operatorState);
      queryClient.setQueryData(deskKeys.session(scope.session), result.session);
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: deskKeys.session(scope.session) }),
        queryClient.invalidateQueries({ queryKey: deskKeys.position(scope.session) }),
        queryClient.invalidateQueries({ queryKey: deskKeys.setup(result.session.setup.id, {
          session: scope.session,
          strategyId: scope.strategyId,
          date: scope.tradingDate
        }) }),
        queryClient.invalidateQueries({ queryKey: operatorKeys.state(scope) })
      ]);
    }
  });
}

export function useOperatorAuth() {
  const [state, setState] = useState<OperatorAuthState>({ status: "loading", email: null, message: null });

  useEffect(() => {
    let active = true;
    let unsubscribe: () => void = () => undefined;
    void operatorAuthAvailable().then(async available => {
      if (!active) return;
      if (!available) {
        setState({ status: "unavailable", email: null, message: "Le service d’authentification opérateur est indisponible." });
        return;
      }
      unsubscribe = await listenToOperatorAuth(user => {
        if (!active) return;
        setState(authStateFromUser(user));
      });
    }).catch(error => {
      if (active) setState({ status: "error", email: null, message: error instanceof Error ? error.message : String(error) });
    });
    return () => {
      active = false;
      unsubscribe();
    };
  }, []);

  const signIn = async () => {
    setState(current => ({ ...current, status: "loading", message: null }));
    try {
      const user = await signInOperator();
      setState(authStateFromUser(user));
    } catch (error) {
      setState({ status: "error", email: null, message: error instanceof Error ? error.message : String(error) });
    }
  };
  const signOut = async () => {
    await signOutOperator();
    setState({ status: "signed_out", email: null, message: null });
  };

  return { ...state, signIn, signOut };
}

function authStateFromUser(user: OperatorUser | null): OperatorAuthState {
  return user
    ? { status: "ready", email: user.email, message: null }
    : { status: "signed_out", email: null, message: null };
}
