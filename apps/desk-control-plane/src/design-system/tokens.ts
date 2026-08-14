export const deskTokens = {
  colors: {
    background: "#03070e",
    panel: "#071522",
    panelStrong: "#071624",
    stroke: "#15304b",
    text: "#e8f2ff",
    muted: "#6f879f",
    cyan: "#159dc4",
    green: "#16d990",
    amber: "#ff9d2e",
    red: "#ff4d5e",
    blue: "#1477f2",
    purple: "#9454e9"
  },
  density: {
    compactRowHeight: 35,
    comfortableRowHeight: 44,
    desktopSidebarWidth: 196,
    desktopTopbarHeight: 64,
    desktopFooterHeight: 32,
    desktopPagePadding: 16,
    desktopGridGap: 10,
    mobileBottomNavHeight: 72
  },
  radius: {
    sm: 5,
    md: 8,
    lg: 10,
    pill: 999
  },
  zIndex: {
    topbar: 40,
    drawer: 80,
    modal: 100
  }
} as const;

export type DeskTone = "neutral" | "accent" | "success" | "warning" | "danger" | "info";

export type DeskDensity = "compact" | "comfortable";
