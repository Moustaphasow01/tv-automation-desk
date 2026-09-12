// @vitest-environment happy-dom
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { OperatorLoginScreen } from "./OperatorLoginScreen";

let host: HTMLDivElement;
let root: Root;
beforeEach(() => {
  (globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
  host = document.createElement("div"); document.body.append(host); root = createRoot(host);
});
afterEach(async () => { await act(async () => root.unmount()); host.remove(); });

async function typePassword(value: string) {
  const input = host.querySelector<HTMLInputElement>('#operator-password')!;
  await act(async () => {
    Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!.call(input, value);
    input.dispatchEvent(new Event('input', { bubbles: true }));
  });
}

describe("Operator connection", () => {
  it("exposes labelled native autofill fields without forcing the mobile keyboard open", async () => {
    await act(async () => root.render(<OperatorLoginScreen state="ready" onLogin={vi.fn()} onRefresh={vi.fn()} />));
    expect(host.querySelector('label[for="operator-login"]')?.textContent).toBe("Identifiant");
    expect(host.querySelector('label[for="operator-password"]')?.textContent).toBe("Mot de passe");
    expect(host.querySelector('input[autocomplete="username"]')).not.toBeNull();
    expect(host.querySelector('input[autocomplete="current-password"]')).not.toBeNull();
    expect(host.querySelector('[autofocus]')).toBeNull();
  });

  it("reveals and hides the entered password without submitting", async () => {
    const onLogin = vi.fn();
    await act(async () => root.render(<OperatorLoginScreen state="ready" onLogin={onLogin} onRefresh={vi.fn()} />));
    await typePassword("test-secret");
    await act(async () => host.querySelector<HTMLButtonElement>('[aria-controls="operator-password"]')!.click());
    expect(host.querySelector<HTMLInputElement>('#operator-password')!.type).toBe("text");
    expect(host.querySelector('[aria-controls="operator-password"]')?.getAttribute('aria-pressed')).toBe("true");
    await act(async () => host.querySelector<HTMLButtonElement>('[aria-controls="operator-password"]')!.click());
    expect(host.querySelector<HTMLInputElement>('#operator-password')!.type).toBe("password");
    expect(host.querySelector<HTMLInputElement>('#operator-password')!.value).toBe("test-secret");
    expect(onLogin).not.toHaveBeenCalled();
  });

  it("preserves input after refusal and never renders server error details", async () => {
    const refresh = vi.fn();
    const onLogin = vi.fn().mockRejectedValue(new Error("SERVER_STACK_SENSITIVE"));
    await act(async () => root.render(<OperatorLoginScreen state="ready" onLogin={onLogin} onRefresh={refresh} />));
    await typePassword("test-secret");
    await act(async () => host.querySelector('form')!.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true })));
    expect(onLogin).toHaveBeenCalledWith({ login: "MSO", password: "test-secret" });
    expect(host.querySelector<HTMLInputElement>('#operator-password')!.value).toBe("test-secret");
    expect(host.querySelector('[role="alert"]')?.textContent).toContain("Vérifiez vos identifiants");
    expect(host.textContent).not.toContain("SERVER_STACK_SENSITIVE");
    expect(refresh).not.toHaveBeenCalled();
  });

  it("blocks competing submissions, hides the password and verifies the session after success", async () => {
    let finish!: () => void;
    const refresh = vi.fn().mockResolvedValue(undefined);
    const onLogin = vi.fn(() => new Promise<void>(resolve => { finish = resolve; }));
    await act(async () => root.render(<OperatorLoginScreen state="ready" onLogin={onLogin} onRefresh={refresh} />));
    await typePassword("test-secret");
    await act(async () => {
      host.querySelector('form')!.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true }));
      host.querySelector('form')!.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true }));
    });
    expect(onLogin).toHaveBeenCalledTimes(1);
    expect(host.querySelector('form')?.getAttribute('aria-busy')).toBe("true");
    expect(host.querySelector<HTMLInputElement>('#operator-password')!.disabled).toBe(true);
    await act(async () => finish());
    expect(refresh).toHaveBeenCalledTimes(1);
    expect(host.querySelector<HTMLInputElement>('#operator-password')!.value).toBe("");
  });

  it("keeps login unavailable until the session can be verified and provides retry", async () => {
    const refresh = vi.fn().mockResolvedValue(undefined);
    await act(async () => root.render(<OperatorLoginScreen state="unavailable" onLogin={vi.fn()} onRefresh={refresh} />));
    expect(host.querySelector('form')).toBeNull();
    expect(host.querySelector('[role="alert"]')?.textContent).toContain("vérifier votre session");
    await act(async () => host.querySelector('button')!.click());
    expect(refresh).toHaveBeenCalledTimes(1);
    await act(async () => root.render(<OperatorLoginScreen state="loading" onLogin={vi.fn()} onRefresh={refresh} />));
    expect(host.querySelector('[role="status"]')?.getAttribute('aria-busy')).toBe("true");
    expect(host.querySelector('form')).toBeNull();
  });
});
