import { Link, useLocation, type LinkProps } from "react-router-dom";
import { FiArrowLeft } from "react-icons/fi";
import { journeyHref, journeyOrigin, journeyReturnLabel, safeJourneyOrigin } from "./journeyRoutes";

export function useJourneyNavigation() {
  const location = useLocation();
  const origin = journeyOrigin(location);
  return { origin, href: (to: string) => journeyHref(to, origin) };
}

export function JourneyLink({ to, ...props }: Omit<LinkProps, "to"> & { to: string }) {
  const { href } = useJourneyNavigation();
  return <Link {...props} to={href(to)} />;
}

export function JourneyBackLink({ fallback = "/live" }: { fallback?: string }) {
  const location = useLocation();
  const to = safeJourneyOrigin(new URLSearchParams(location.search).get("returnTo")) ?? fallback;
  return <Link className="dj-back" to={to}><FiArrowLeft aria-hidden="true" />{journeyReturnLabel(to)}</Link>;
}
