import { Link } from "react-router-dom";
import { Component, type ErrorInfo, type ReactNode } from "react";

type RouteErrorBoundaryProps = {
  message?: string;
  onRetry?: () => void;
};

export function RouteErrorBoundary({ message, onRetry }: RouteErrorBoundaryProps) {
  return (
    <section className="route-error" role="alert" aria-labelledby="route-error-title">
      <p className="eyebrow">Erreur applicative</p>
      <h1 id="route-error-title">Le module n’a pas pu être affiché.</h1>
      <p>{message ?? "Une erreur de rendu est survenue dans le Control Plane."}</p>
      <div className="cluster">
        {onRetry ? <button className="desk-button" type="button" onClick={onRetry}>Réessayer</button> : null}
        <Link className="desk-button" to="/command-center">Retour Command Center</Link>
      </div>
    </section>
  );
}

type DeskRouteErrorBoundaryProps = {
  children: ReactNode;
  resetKey: string;
};

export class DeskRouteErrorBoundary extends Component<DeskRouteErrorBoundaryProps, { error: Error | null }> {
  state: { error: Error | null } = { error: null };

  static getDerivedStateFromError(error: Error) {
    return { error };
  }

  componentDidCatch(error: Error, info: ErrorInfo) {
    window.dispatchEvent(new CustomEvent("desk:telemetry", { detail: { event: "front.render.failed", error: error.message, stack: info.componentStack } }));
  }

  componentDidUpdate(previousProps: DeskRouteErrorBoundaryProps) {
    if (this.state.error && previousProps.resetKey !== this.props.resetKey) {
      this.setState({ error: null });
    }
  }

  render() {
    if (this.state.error) {
      return <RouteErrorBoundary message={this.state.error.message} onRetry={() => this.setState({ error: null })} />;
    }
    return this.props.children;
  }
}
