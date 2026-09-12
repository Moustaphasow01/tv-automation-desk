import { useRef, useState, type FormEvent } from "react";
import { FiArrowRight, FiEye, FiEyeOff, FiLock } from "react-icons/fi";
import type { OperatorLoginCredentials } from "@/shared/transport";
import "@/features/live-trading/workspace/workspace.tokens.css";
import "./operator-login.css";

type Props = {
  state: "loading" | "unavailable" | "ready";
  onLogin(credentials: OperatorLoginCredentials): Promise<void>;
  onRefresh(): Promise<void>;
};

export function OperatorLoginScreen({ state, onLogin, onRefresh }: Props) {
  return <main className="operator-login-gate">
    <header className="operator-login-gate__brand"><FiLock aria-hidden="true" /><span>Desk Futures</span><span>Accès privé</span></header>
    <section className="operator-login-gate__card" aria-labelledby="operator-login-title">
      <h1 id="operator-login-title">Connexion au desk</h1>
      <p className="operator-login-gate__intro">Retrouvez vos marchés et votre séance.</p>
      {state === "loading" ? <div className="operator-login-gate__loading" role="status" aria-busy="true"><span />Vérification de votre session…</div>
        : state === "unavailable" ? <div className="operator-login-gate__recovery"><p role="alert">Le desk ne peut pas vérifier votre session pour le moment. Réessayez dans un instant.</p><button type="button" onClick={() => void onRefresh()}>Réessayer</button></div>
        : <OperatorLoginForm onLogin={onLogin} onRefresh={onRefresh} />}
      <p className="operator-login-gate__hint"><FiLock aria-hidden="true" />Votre accès et vos droits sont vérifiés à la connexion.</p>
    </section>
    <footer className="operator-login-gate__footer">Desk Futures<span>Votre espace de trading</span></footer>
  </main>;
}

function OperatorLoginForm({ onLogin, onRefresh }: Omit<Props, "state">) {
  const [login, setLogin] = useState("MSO");
  const [password, setPassword] = useState("");
  const [visible, setVisible] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const pending = useRef(false);
  const submit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (pending.current) return;
    if (!login.trim() || !password) { setError("Renseignez votre identifiant et votre mot de passe."); return; }
    pending.current = true; setSubmitting(true); setError(null); setVisible(false);
    try {
      await onLogin({ login: login.trim(), password });
      setPassword("");
      await onRefresh();
    } catch {
      setError("Connexion impossible. Vérifiez vos identifiants et réessayez. Si le problème persiste, contactez votre administrateur.");
    } finally { pending.current = false; setSubmitting(false); }
  };
  return <form className="operator-login-gate__form" onSubmit={submit} aria-busy={submitting} aria-describedby={error ? "operator-login-error" : undefined}>
    <label htmlFor="operator-login">Identifiant</label>
    <input id="operator-login" name="username" autoComplete="username" autoCapitalize="none" spellCheck={false} required
      value={login} onChange={event => setLogin(event.target.value)} disabled={submitting} />
    <label htmlFor="operator-password">Mot de passe</label>
    <div className="operator-login-gate__password">
      <input id="operator-password" name="password" type={visible ? "text" : "password"} autoComplete="current-password" required
        value={password} onChange={event => setPassword(event.target.value)} disabled={submitting} />
      <button type="button" aria-label={visible ? "Masquer le mot de passe" : "Afficher le mot de passe"} aria-controls="operator-password" aria-pressed={visible}
        disabled={submitting} onClick={() => setVisible(value => !value)}>{visible ? <FiEyeOff aria-hidden="true" /> : <FiEye aria-hidden="true" />}</button>
    </div>
    {error ? <p id="operator-login-error" className="operator-login-gate__error" role="alert">{error}</p> : null}
    <button className="operator-login-gate__submit" type="submit" disabled={submitting || !login.trim() || !password}>
      {submitting ? "Ouverture de session…" : "Entrer dans le desk"}<FiArrowRight aria-hidden="true" />
    </button>
  </form>;
}
