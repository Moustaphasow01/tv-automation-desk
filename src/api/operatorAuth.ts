export type OperatorUser = {
  email: string | null;
  displayName: string | null;
  getIdToken: () => Promise<string>;
};

type OperatorListener = (user: OperatorUser | null) => void;
type Unsubscribe = () => void;

const localApiKey = String(import.meta.env.VITE_DESK_API_KEY || "").trim();
const listeners = new Set<OperatorListener>();
let signedIn = Boolean(localApiKey);

export async function listenToOperatorAuth(listener: OperatorListener): Promise<Unsubscribe> {
  listeners.add(listener);
  listener(currentUser());
  return () => listeners.delete(listener);
}

export async function signInOperator(): Promise<OperatorUser> {
  if (!localApiKey) {
    throw new Error("La clé opérateur locale VITE_DESK_API_KEY n’est pas configurée.");
  }
  signedIn = true;
  const user = currentUser();
  if (!user) throw new Error("Impossible d’initialiser l’opérateur local.");
  notify();
  return user;
}

export async function signOutOperator(): Promise<void> {
  signedIn = false;
  notify();
}

export async function getOperatorIdToken(): Promise<string | null> {
  return signedIn ? localApiKey || null : null;
}

export async function operatorAuthAvailable(): Promise<boolean> {
  return Boolean(localApiKey);
}

function currentUser(): OperatorUser | null {
  if (!signedIn || !localApiKey) return null;
  return {
    email: "preprod.operator@desk.local",
    displayName: "Opérateur préproduction",
    getIdToken: async () => localApiKey,
  };
}

function notify(): void {
  const user = currentUser();
  for (const listener of listeners) listener(user);
}
