import { useEffect, useRef, useState } from "react";
import { Link } from "react-router-dom";
import { FaChevronDown, FaCog, FaIdBadge, FaUserCircle } from "react-icons/fa";
import "@/shell/operator-menu.css";

type OperatorMenuProps = {
  displayName: string;
  roleLabel: string;
  variant: "command-center" | "live-trading";
};

export function OperatorMenu({ displayName, roleLabel, variant }: OperatorMenuProps) {
  const [open, setOpen] = useState(false);
  const rootRef = useRef<HTMLDivElement>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const firstItemRef = useRef<HTMLAnchorElement>(null);

  useEffect(() => {
    if (!open) return undefined;
    firstItemRef.current?.focus();
    const closeOutside = (event: PointerEvent) => {
      if (!rootRef.current?.contains(event.target as Node)) setOpen(false);
    };
    const closeOnEscape = (event: KeyboardEvent) => {
      if (event.key !== "Escape") return;
      setOpen(false);
      triggerRef.current?.focus();
    };
    document.addEventListener("pointerdown", closeOutside);
    document.addEventListener("keydown", closeOnEscape);
    return () => {
      document.removeEventListener("pointerdown", closeOutside);
      document.removeEventListener("keydown", closeOnEscape);
    };
  }, [open]);

  return (
    <div className={`operator-menu operator-menu--${variant}`} ref={rootRef}>
      <button
        ref={triggerRef}
        type="button"
        className="operator-menu__trigger"
        aria-label={`Menu opérateur de ${displayName}`}
        aria-haspopup="menu"
        aria-expanded={open}
        onClick={() => setOpen((value) => !value)}
      >
        <FaUserCircle className="operator-menu__avatar" aria-hidden="true" />
        <span className="operator-menu__copy"><strong>{displayName}</strong><small>{roleLabel}</small></span>
        <FaChevronDown className="operator-menu__chevron" aria-hidden="true" />
      </button>
      {open ? (
        <div className="operator-menu__popover" role="menu" aria-label="Navigation opérateur">
          <Link ref={firstItemRef} role="menuitem" to="/auth" onClick={() => setOpen(false)}><FaIdBadge aria-hidden="true" /><span>Profil et accès</span></Link>
          <Link role="menuitem" to="/settings" onClick={() => setOpen(false)}><FaCog aria-hidden="true" /><span>Réglages opérateur</span></Link>
        </div>
      ) : null}
    </div>
  );
}
