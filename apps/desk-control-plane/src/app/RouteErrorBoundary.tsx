import { Link } from "react-router-dom";
import { Component, type ErrorInfo, type ReactNode } from "react";

type RouteErrorBoundaryProps = {
  message?: string;
};

export function RouteErrorBoundary({ message }: RouteErrorBoundaryProps) {
  return (
    <main className="route-error" role="alert">
      <p className="eyebrow">Erreur applicative</p>
      <h1>Le module n’a pas pu être affiché.</h1>
      <p>{message ?? "Une erreur de rendu est survenue dans le Control Plane."}</p>
      <Link className="desk-button" to="/command-center">
        Retour Command Center
      </Link>
    </main>
  );
}

export class DeskRouteErrorBoundary extends Component<{ children: ReactNode }, { error: Error | null }> {
  state: { error: Error | null } = { error: null };

  static getDerivedStateFromError(error: Error) {
    return { error };
  }

  componentDidCatch(error: Error, info: ErrorInfo) {
    window.dispatchEvent(new CustomEvent("desk:telemetry", { detail: { event: "front.render.failed", error: error.message, stack: info.componentStack } }));
  }

  render() {
    if (this.state.error) return <RouteErrorBoundary message={this.state.error.message} />;
    return this.props.children;
  }
}
