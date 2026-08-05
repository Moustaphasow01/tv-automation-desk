export type OperatorUser = {
  email: string | null;
  displayName: string | null;
  getIdToken: () => Promise<string>;
};

type OperatorListener = (user: OperatorUser | null) => void;
type Unsubscribe = () => void;

const localApiKey = String(import.meta.env.VITE_DESK_API_KEY || "").trim();
const apiBase = String(import.meta.env.VITE_API_BASE_URL || "/api/v1").replace(/\/+$/, "");
const listeners = new Set<OperatorListener>();
let user: OperatorUser | null = localApiKey ? localDevelopmentUser() : null;

export async function listenToOperatorAuth(listener: OperatorListener): Promise<Unsubscribe> {
  listeners.add(listener);
  if (!localApiKey) await refreshServerSession();
  listener(user);
  return () => listeners.delete(listener);
}

export async function signInOperator(): Promise<OperatorUser> {
  if (localApiKey) {
    user = localDevelopmentUser();
    notify();
    return user;
  }
  const pin = window.prompt("PIN opérateur Desk");
  if (!pin) throw new Error("Connexion opérateur annulée.");
  const response = await fetch(`${apiBase}/auth/operator/login`, {
    method: "POST",
    credentials: "include",
    headers: { Accept: "application/json", "Content-Type": "application/json" },
    body: JSON.stringify({ pin }),
  });
  const payload = await response.json().catch(() => null) as OperatorSessionResponse | null;
  if (!response.ok || !payload?.authenticated || !payload.user) {
    throw new Error(payload?.error || "Connexion opérateur refusée.");
  }
  user = serverUser(payload.user);
  notify();
  return user;
}

export async function signOutOperator(): Promise<void> {
  if (!localApiKey) {
    await fetch(`${apiBase}/auth/operator/logout`, {
      method: "POST",
      credentials: "include",
      headers: { Accept: "application/json" },
    });
  }
  user = null;
  notify();
}

export async function getOperatorIdToken(): Promise<string | null> {
  return user && localApiKey ? localApiKey : null;
}

export async function operatorAuthAvailable(): Promise<boolean> {
  if (localApiKey) return true;
  try {
    await refreshServerSession();
    return true;
  } catch {
    return false;
  }
}

function localDevelopmentUser(): OperatorUser {
  return {
    email: "preprod.operator@desk.local",
    displayName: "Opérateur préproduction",
    getIdToken: async () => localApiKey,
  };
}

async function refreshServerSession(): Promise<void> {
  const response = await fetch(`${apiBase}/auth/operator/session`, {
    credentials: "include",
    headers: { Accept: "application/json" },
  });
  if (!response.ok) throw new Error(`Session opérateur indisponible (${response.status}).`);
  const payload = await response.json() as OperatorSessionResponse;
  user = payload.authenticated && payload.user ? serverUser(payload.user) : null;
}

function serverUser(identity: { email: string | null; displayName: string | null }): OperatorUser {
  return {
    email: identity.email,
    displayName: identity.displayName,
    getIdToken: async () => "",
  };
}

function notify(): void {
  for (const listener of listeners) listener(user);
}

type OperatorSessionResponse = {
  authenticated?: boolean;
  user?: { email: string | null; displayName: string | null };
  error?: string;
};
