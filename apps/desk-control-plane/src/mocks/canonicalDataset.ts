import type { ViewEnvelope } from "@/shared/contracts";
import type {
  AdminAccessView,
  AuthSessionView,
  CommandCenterView,
  DemoPaperReadinessView,
  ExecutionIncidentsView,
  ExecutionProvidersView,
  EventsAuditView,
  JarvisWorkspaceView,
  LiveSignalDetailView,
  LiveTradingView,
  OperationsQueueView,
  OperatorSettingsView,
  OrdersView,
  PortfolioView,
  RiskView,
  ResearchAgentFleetView,
  ResearchComputeSchedulerView,
  ResearchDataCatalogView,
  ResearchExperimentDetailView,
  ResearchLabView,
  ResearchRunDetailView,
  StrategyCenterView,
  StrategyCompareView,
  StrategyDetailView
} from "@/domains/front-api/viewModels";

const generatedAt = "2026-08-10T09:40:00.000Z";
const commonMeta = {
  generatedAt,
  asOf: "2026-08-10T09:39:42.000Z",
  stale: false,
  latencyMs: 42,
  correlationId: "corr_vnext_demo_20260810_0940",
  schemaVersion: "1.0.0" as const
};

const commonPermissions = [
  { capability: "auth.read", allowed: true },
  { capability: "command-center.read", allowed: true },
  { capability: "auth.command", allowed: true },
  { capability: "auth.step_up", allowed: false, reason: "Step-up requis", requiresStepUp: true },
  { capability: "events.read", allowed: true },
  { capability: "events.export", allowed: true },
  { capability: "portfolio.read", allowed: true },
  { capability: "research.read", allowed: true },
  { capability: "research.experiment.read", allowed: true },
  { capability: "research.experiment.command", allowed: true },
  { capability: "research.run.read", allowed: true },
  { capability: "research.agents.read", allowed: true },
  { capability: "research.agents.command", allowed: true },
  { capability: "research.data.read", allowed: true },
  { capability: "research.data.command", allowed: true },
  { capability: "research.compute.read", allowed: true },
  { capability: "research.compute.command", allowed: true },
  { capability: "strategies.read", allowed: true },
  { capability: "strategy.read", allowed: true },
  { capability: "strategy.compare", allowed: true },
  { capability: "live.read", allowed: true },
  { capability: "live.signal.read", allowed: true },
  { capability: "live.signal.command", allowed: true },
  { capability: "orders.read", allowed: true },
  { capability: "orders.command", allowed: true },
  { capability: "risk.read", allowed: true },
  { capability: "risk.command", allowed: true },
  { capability: "risk.emergency", allowed: false, reason: "Step-up emergency requis", requiresStepUp: true },
  { capability: "execution.providers.read", allowed: true },
  { capability: "execution.providers.command", allowed: true },
  { capability: "execution.providers.switch", allowed: false, reason: "Step-up simulation requis", requiresStepUp: true },
  { capability: "execution.incidents.read", allowed: true },
  { capability: "execution.incidents.command", allowed: true },
  { capability: "execution.incidents.emergency", allowed: false, reason: "Step-up emergency requis", requiresStepUp: true },
  { capability: "jarvis.read", allowed: true },
  { capability: "settings.read", allowed: true },
  { capability: "settings.command", allowed: true },
  { capability: "settings.device.revoke", allowed: false, reason: "Step-up requis", requiresStepUp: true },
  { capability: "admin.read", allowed: true },
  { capability: "admin.command", allowed: false, reason: "Admin step-up requis", requiresStepUp: true },
  { capability: "orders.create", allowed: false, reason: "Mode mock read-only", requiresStepUp: true }
] as const;

const strategyInstanceId = "strinst_breakout_retest_mnq_vnext_demo";
const signalId = "sig_vnext_demo_mnq_0940";

export const authSessionView: ViewEnvelope<AuthSessionView> = {
  meta: commonMeta,
  permissions: commonPermissions,
  data: {
    summary: {
      authenticated: true,
      environment: "PAPER",
      sessionState: "ACTIVE",
      minutesToExpiry: 42,
      permissionsGranted: 24,
      permissionsDenied: 5,
      stepUpReady: true,
      readOnly: false
    },
    principal: {
      userId: "usr_operator_alex_martin",
      displayName: "Alexandre Martin",
      maskedEmail: "a***@desk.local",
      identityProvider: "SSO",
      roles: ["OPERATOR", "RISK_VIEWER", "EXECUTION_CONTROLLER"],
      desks: ["Futures Desk", "Research Lab"],
      accountScopes: ["acct_sim101_main", "acct_pickmytrade_demo", "acct_internal_demo"],
      timezone: "Europe/Paris",
      lastLoginAt: "2026-08-10T08:58:11.000Z"
    },
    environments: [
      {
        environment: "PAPER",
        label: "Paper trading · VPS preprod",
        current: true,
        tradingEnabled: true,
        writeEnabled: true,
        riskProfile: "Sim101 guarded",
        accountIds: ["acct_sim101_main", "acct_internal_demo"],
        status: "AVAILABLE"
      },
      {
        environment: "STAGING",
        label: "Staging BFF",
        current: false,
        tradingEnabled: false,
        writeEnabled: false,
        riskProfile: "Read-only validation",
        accountIds: ["acct_internal_demo"],
        status: "READ_ONLY"
      },
      {
        environment: "LIVE",
        label: "Live locked",
        current: false,
        tradingEnabled: false,
        writeEnabled: false,
        riskProfile: "Live disabled until cutover",
        accountIds: [],
        status: "LOCKED"
      }
    ],
    session: {
      sessionId: "sess_vnext_operator_20260810_085811",
      issuedAt: "2026-08-10T08:58:11.000Z",
      expiresAt: "2026-08-10T10:22:11.000Z",
      refreshAfterAt: "2026-08-10T10:05:00.000Z",
      refreshStatus: "READY",
      deviceLabel: "VPS operator console",
      httpOnlySession: true,
      browserMaterialExposure: "NONE",
      legacyStoreImported: false,
      csrfBinding: "BOUND"
    },
    permissions: [
      { capability: "command-center.read", label: "Command Center", domain: "COMMAND", decision: "ALLOW", reason: "Scope opérateur standard.", requiresStepUp: false },
      { capability: "live.read", label: "Live Trading", domain: "LIVE", decision: "ALLOW", reason: "Lecture session live autorisée.", requiresStepUp: false },
      { capability: "orders.command", label: "Orders command", domain: "EXECUTION", decision: "ALLOW", reason: "Commandes paper autorisées via BFF.", requiresStepUp: false },
      { capability: "risk.emergency", label: "Emergency Risk", domain: "RISK", decision: "STEP_UP_REQUIRED", reason: "Action critique protégée.", requiresStepUp: true },
      { capability: "execution.providers.switch", label: "Provider switch", domain: "EXECUTION", decision: "STEP_UP_REQUIRED", reason: "Bascule provider simulation-only avec step-up.", requiresStepUp: true },
      { capability: "orders.create", label: "Créer ordre direct", domain: "EXECUTION", decision: "DENY", reason: "Aucun ordre direct depuis le front VNext.", requiresStepUp: true },
      { capability: "admin.read", label: "Administration", domain: "ADMIN", decision: "READ_ONLY", reason: "Audit visible, mutations admin non exposées.", requiresStepUp: true }
    ],
    routeGuards: [
      { route: "/live", capability: "live.read", decision: "ALLOW", reason: "Route trading lisible." },
      { route: "/orders", capability: "orders.read", decision: "ALLOW", reason: "Route orders lisible." },
      { route: "/risk", capability: "risk.read", decision: "ALLOW", reason: "Route risk lisible." },
      { route: "/execution/providers", capability: "execution.providers.read", decision: "ALLOW", reason: "Provider cockpit lisible." },
      { route: "/execution/providers:switch", capability: "execution.providers.switch", decision: "STEP_UP_REQUIRED", reason: "Switch primary requiert contrôle élevé." },
      { route: "/admin", capability: "admin.write", decision: "DENY", reason: "Mutations admin non disponibles dans ce scope." }
    ],
    stepUp: {
      ready: true,
      requiredFor: ["risk.emergency", "execution.providers.switch", "execution.incident.resolve", "admin.write"],
      methods: [
        { methodId: "mfa_totp_operator", label: "MFA opérateur", state: "AVAILABLE", lastVerifiedAt: "2026-08-10T08:58:11.000Z" },
        { methodId: "pin_operator_gate", label: "PIN gate", state: "AVAILABLE", lastVerifiedAt: "2026-08-10T09:35:00.000Z" },
        { methodId: "hardware_key_backup", label: "Hardware key backup", state: "DEGRADED" }
      ]
    },
    events: [
      { eventId: "evt_auth_login_ok", at: "2026-08-10T08:58:11.000Z", title: "Session ouverte", eventType: "auth.session.opened", status: "OK", correlationId: "corr_auth_session_20260810" },
      { eventId: "evt_auth_scope_loaded", at: "2026-08-10T08:58:12.000Z", title: "Scopes chargés", eventType: "auth.scope.loaded", status: "OK", correlationId: "corr_auth_session_20260810" },
      { eventId: "evt_auth_stepup_ready", at: "2026-08-10T09:35:00.000Z", title: "Step-up prêt", eventType: "auth.stepup.ready", status: "OK", correlationId: "corr_auth_session_20260810" },
      { eventId: "evt_auth_live_locked", at: "2026-08-10T09:40:00.000Z", title: "LIVE verrouillé", eventType: "auth.environment.locked", status: "WATCH", correlationId: "corr_auth_session_20260810" }
    ],
    commandActions: [
      {
        actionId: "act_auth_refresh_session",
        label: "Actualiser la session",
        commandType: "auth.session.refresh",
        permission: "ALLOWED",
        requiresConfirmation: false,
        criticality: "LOW",
        expectedVersion: "authver_sess_vnext_operator_20260810_085811",
        impactSummary: "Demande au BFF de prolonger la session httpOnly si le scope reste valide.",
        payload: { sessionId: "sess_vnext_operator_20260810_085811", reasonCode: "OPERATOR_ACTIVE" }
      },
      {
        actionId: "act_auth_request_stepup",
        label: "Request step-up",
        commandType: "auth.step_up.request",
        permission: "ALLOWED",
        requiresConfirmation: true,
        criticality: "MEDIUM",
        expectedVersion: "authver_sess_vnext_operator_20260810_085811",
        impactSummary: "Prépare une preuve step-up pour actions critiques sans effectuer la mutation cible.",
        payload: { sessionId: "sess_vnext_operator_20260810_085811", methodId: "pin_operator_gate" }
      },
      {
        actionId: "act_auth_logout",
        label: "Logout",
        commandType: "auth.session.logout",
        permission: "STEP_UP_REQUIRED",
        requiresConfirmation: true,
        criticality: "HIGH",
        expectedVersion: "authver_sess_vnext_operator_20260810_085811",
        impactSummary: "Ferme la session opérateur et coupe les commandes VNext.",
        payload: { sessionId: "sess_vnext_operator_20260810_085811", revokeRealtime: true }
      }
    ]
  }
};

export const operatorSettingsView: ViewEnvelope<OperatorSettingsView> = {
  meta: commonMeta,
  permissions: commonPermissions,
  data: {
    summary: {
      theme: "DARK",
      density: "COMPACT",
      language: "fr-FR",
      timezone: "Europe/Paris",
      notificationsEnabled: true,
      voiceState: "DEGRADED",
      activeDevices: 2,
      activeSessions: 2,
      privacyMode: "STRICT"
    },
    cockpitPreferences: [
      { preferenceId: "pref_theme", label: "Thème cockpit", category: "THEME", value: "DARK", allowedValues: ["DARK", "LIGHT", "SYSTEM"], optimisticAllowed: true, critical: false },
      { preferenceId: "pref_density", label: "Densité opérateur", category: "DENSITY", value: "COMPACT", allowedValues: ["COMPACT", "COMFORT"], optimisticAllowed: true, critical: false },
      { preferenceId: "pref_language", label: "Langue", category: "FORMAT", value: "fr-FR", allowedValues: ["fr-FR", "en-US"], optimisticAllowed: true, critical: false },
      { preferenceId: "pref_timezone", label: "Timezone", category: "FORMAT", value: "Europe/Paris", allowedValues: ["Europe/Paris", "America/New_York", "Asia/Tokyo"], optimisticAllowed: true, critical: false },
      { preferenceId: "pref_currency", label: "Format monétaire", category: "FORMAT", value: "USD compact", allowedValues: ["USD compact", "USD full", "EUR compact"], optimisticAllowed: true, critical: false }
    ],
    widgets: [
      { widgetId: "wid_command_health", label: "Command health", area: "COMMAND", visible: true, order: 1, refreshSeconds: 15 },
      { widgetId: "wid_live_pipeline", label: "Live pipeline", area: "LIVE", visible: true, order: 2, refreshSeconds: 15 },
      { widgetId: "wid_execution_incidents", label: "Execution incidents", area: "EXECUTION", visible: true, order: 3, refreshSeconds: 30 },
      { widgetId: "wid_research_budget", label: "Research budget", area: "RESEARCH", visible: true, order: 4, refreshSeconds: 60 },
      { widgetId: "wid_risk_summary", label: "Risk summary", area: "RISK", visible: true, order: 5, refreshSeconds: 30 }
    ],
    notificationRules: [
      { ruleId: "notif_live_signal", channel: "DESKTOP", label: "Signal live prêt", enabled: true, severity: "INFO" },
      { ruleId: "notif_risk_watch", channel: "TELEGRAM", label: "Risk WATCH", enabled: true, severity: "WARNING", quietHours: "22:30–07:30" },
      { ruleId: "notif_execution_critical", channel: "SOUND", label: "Incident execution critique", enabled: true, severity: "CRITICAL" },
      { ruleId: "notif_research_done", channel: "EMAIL", label: "Run research terminé", enabled: false, severity: "INFO" }
    ],
    jarvis: {
      voiceState: "DEGRADED",
      pushToTalkEnabled: true,
      wakeWordEnabled: false,
      transcriptRetention: "SESSION_ONLY",
      lastVoiceCheckAt: "2026-08-10T09:39:00.000Z"
    },
    shortcuts: [
      { shortcutId: "kbd_command", label: "Command Center", keys: "G C", route: "/command-center", enabled: true },
      { shortcutId: "kbd_live", label: "Live Trading", keys: "G L", route: "/live", enabled: true },
      { shortcutId: "kbd_orders", label: "Orders", keys: "G O", route: "/orders", enabled: true },
      { shortcutId: "kbd_incidents", label: "Incidents", keys: "G I", route: "/execution/incidents", enabled: true }
    ],
    devices: [
      { deviceId: "dev_vps_operator_console", label: "VPS operator console", kind: "VPS", trusted: true, lastSeenAt: "2026-08-10T09:40:00.000Z", sessionId: "sess_vnext_operator_20260810_085811", state: "ACTIVE" },
      { deviceId: "dev_desktop_chrome", label: "Desktop Chrome", kind: "DESKTOP", trusted: true, lastSeenAt: "2026-08-10T09:12:00.000Z", sessionId: "sess_desktop_observer_20260810_091200", state: "ACTIVE" },
      { deviceId: "dev_mobile_watch", label: "Mobile observer", kind: "MOBILE", trusted: false, lastSeenAt: "2026-08-09T18:20:00.000Z", state: "REVOKABLE" }
    ],
    privacy: [
      { policyId: "privacy_browser_material", label: "Matière sensible navigateur", value: "NONE", editable: false, reason: "Contrôlé par Auth Session BFF." },
      { policyId: "privacy_transcript_retention", label: "Rétention transcripts Jarvis", value: "SESSION_ONLY", editable: true, reason: "Préférence opérateur non critique." },
      { policyId: "privacy_analytics", label: "Telemetry cockpit", value: "LOCAL_ONLY", editable: true, reason: "Mesures UI locales sans contenu métier brut." }
    ],
    guardrails: [
      { guardrailId: "guard_no_risk_mutation", label: "Aucune mutation risk", status: "PASS", detail: "Les budgets, limites et circuit breakers restent dans Risk Center." },
      { guardrailId: "guard_no_execution_mutation", label: "Aucune mutation execution", status: "PASS", detail: "Providers, orders et incidents restent dans leurs domaines dédiés." },
      { guardrailId: "guard_optimistic_scope", label: "Optimistic UI bornée", status: "PASS", detail: "Optimistic uniquement pour thème, densité, langue et widgets." },
      { guardrailId: "guard_voice_degraded", label: "Voice degraded visible", status: "WATCH", detail: "Push-to-talk disponible, service voice dégradé." }
    ],
    commandActions: [
      {
        actionId: "act_settings_save_preferences",
        label: "Sauver préférences",
        commandType: "settings.preferences.save",
        permission: "ALLOWED",
        requiresConfirmation: false,
        criticality: "LOW",
        expectedVersion: "settingsver_operator_20260810_0940",
        impactSummary: "Persiste thème, densité, langue, timezone et widgets non critiques.",
        optimisticAllowed: true,
        payload: { preferenceScope: "cockpit", optimistic: true }
      },
      {
        actionId: "act_settings_test_notification",
        label: "Tester notification",
        commandType: "settings.notification.test",
        permission: "ALLOWED",
        requiresConfirmation: false,
        criticality: "LOW",
        expectedVersion: "settingsver_operator_20260810_0940",
        impactSummary: "Envoie un test notification sans modifier les règles métier.",
        optimisticAllowed: true,
        payload: { ruleId: "notif_live_signal", channel: "DESKTOP" }
      },
      {
        actionId: "act_settings_test_voice",
        label: "Tester voice",
        commandType: "settings.voice.test",
        permission: "ALLOWED",
        requiresConfirmation: true,
        criticality: "MEDIUM",
        expectedVersion: "settingsver_operator_20260810_0940",
        impactSummary: "Teste push-to-talk/Jarvis voice sans déclencher d’action métier.",
        optimisticAllowed: false,
        payload: { service: "jarvis_voice", pushToTalk: true }
      },
      {
        actionId: "act_settings_revoke_mobile",
        label: "Révoquer mobile",
        commandType: "settings.device.revoke",
        permission: "STEP_UP_REQUIRED",
        requiresConfirmation: true,
        criticality: "HIGH",
        expectedVersion: "settingsver_operator_20260810_0940",
        impactSummary: "Révoque uniquement l’appareil observateur mobile après step-up.",
        optimisticAllowed: false,
        payload: { deviceId: "dev_mobile_watch", revokeSessions: true }
      },
      {
        actionId: "act_settings_reset_preferences",
        label: "Reset préférences",
        commandType: "settings.preferences.reset",
        permission: "ALLOWED",
        requiresConfirmation: true,
        criticality: "MEDIUM",
        expectedVersion: "settingsver_operator_20260810_0940",
        impactSummary: "Réinitialise les préférences UI non critiques au profil desk par défaut.",
        optimisticAllowed: false,
        payload: { preferenceScope: "cockpit", profile: "desk_default" }
      }
    ]
  }
};

export const adminAccessView: ViewEnvelope<AdminAccessView> = {
  meta: commonMeta,
  permissions: commonPermissions,
  data: {
    summary: {
      accessMode: "READ_ONLY",
      users: 4,
      activeUsers: 2,
      roles: 4,
      capabilities: 8,
      accountGroups: 3,
      pendingChanges: 2,
      auditEvents: 5
    },
    currentAccess: {
      userId: "usr_operator_alex_martin",
      roles: ["OPERATOR", "ADMIN_VIEWER"],
      canMutate: false,
      readOnlyReason: "Mutation admin requiert rôle ADMIN_OWNER + step-up.",
      stepUpReady: true
    },
    users: [
      { userId: "usr_operator_alex_martin", displayName: "Alexandre Martin", maskedEmail: "a***@desk.local", roles: ["OPERATOR", "ADMIN_VIEWER"], status: "ACTIVE", mfaState: "READY", accountGroupIds: ["grp_paper_sim101"], lastSeenAt: "2026-08-10T09:40:00.000Z" },
      { userId: "usr_risk_owner", displayName: "Risk Owner", maskedEmail: "r***@desk.local", roles: ["RISK_ADMIN"], status: "ACTIVE", mfaState: "READY", accountGroupIds: ["grp_paper_sim101", "grp_live_locked"], lastSeenAt: "2026-08-10T09:10:00.000Z" },
      { userId: "usr_research_guest", displayName: "Research Guest", maskedEmail: "q***@desk.local", roles: ["RESEARCH_VIEWER"], status: "INVITED", mfaState: "REQUIRED", accountGroupIds: ["grp_research_demo"] },
      { userId: "usr_legacy_operator", displayName: "Legacy Operator", maskedEmail: "l***@desk.local", roles: ["OPERATOR"], status: "LOCKED", mfaState: "LOCKED", accountGroupIds: ["grp_paper_sim101"], lastSeenAt: "2026-08-07T18:02:00.000Z" }
    ],
    roles: [
      { roleId: "role_admin_owner", label: "Admin Owner", description: "Peut approuver les mutations admin critiques.", userCount: 0, capabilityCount: 12, riskLevel: "HIGH", stepUpRequired: true },
      { roleId: "role_admin_viewer", label: "Admin Viewer", description: "Lecture RBAC et audit sans mutation.", userCount: 1, capabilityCount: 8, riskLevel: "MEDIUM", stepUpRequired: false },
      { roleId: "role_operator", label: "Operator", description: "Opère le desk paper via Command Runtime.", userCount: 2, capabilityCount: 24, riskLevel: "MEDIUM", stepUpRequired: true },
      { roleId: "role_research_viewer", label: "Research Viewer", description: "Lecture Research Lab uniquement.", userCount: 1, capabilityCount: 7, riskLevel: "LOW", stepUpRequired: false }
    ],
    capabilities: [
      { capability: "admin.read", domain: "ADMIN", decision: "ALLOW", sourceRole: "ADMIN_VIEWER", reason: "Audit RBAC lisible." },
      { capability: "admin.command", domain: "ADMIN", decision: "STEP_UP_REQUIRED", sourceRole: "ADMIN_OWNER", reason: "Mutation admin critique." },
      { capability: "auth.session.logout", domain: "AUTH", decision: "STEP_UP_REQUIRED", sourceRole: "ADMIN_OWNER", reason: "Force logout protégé." },
      { capability: "execution.providers.read", domain: "EXECUTION", decision: "ALLOW", sourceRole: "OPERATOR", reason: "Provider access read-only depuis Admin." },
      { capability: "execution.providers.switch", domain: "EXECUTION", decision: "DENY", sourceRole: "RISK_ADMIN", reason: "Switch provider hors domaine Admin." },
      { capability: "risk.emergency", domain: "RISK", decision: "READ_ONLY", sourceRole: "RISK_ADMIN", reason: "Politiques visibles, activation dans Risk Center." },
      { capability: "settings.command", domain: "SETTINGS", decision: "ALLOW", sourceRole: "OPERATOR", reason: "Préférences non critiques." },
      { capability: "orders.create", domain: "EXECUTION", decision: "DENY", sourceRole: "OPERATOR", reason: "Aucun ordre direct." }
    ],
    accountGroups: [
      { groupId: "grp_paper_sim101", label: "Paper Sim101", environment: "PAPER", accountIds: ["acct_sim101_main", "acct_internal_demo"], providerIds: ["provider_ninjatrader_sim101"], status: "ACTIVE" },
      { groupId: "grp_research_demo", label: "Research demo", environment: "STAGING", accountIds: ["acct_internal_demo"], providerIds: ["provider_simulated_feed"], status: "READ_ONLY" },
      { groupId: "grp_live_locked", label: "Live locked", environment: "LIVE", accountIds: [], providerIds: [], status: "LOCKED" }
    ],
    policies: [
      { policyId: "pol_admin_double_validation", label: "Double validation admin", confirmationMode: "DOUBLE_VALIDATION", enabled: true, scope: "admin.command", status: "PASS" },
      { policyId: "pol_provider_stepup", label: "Provider access step-up", confirmationMode: "STEP_UP", enabled: true, scope: "execution.providers.switch", status: "PASS" },
      { policyId: "pol_force_logout", label: "Force logout guarded", confirmationMode: "STEP_UP", enabled: true, scope: "auth.session.logout", status: "PASS" },
      { policyId: "pol_live_locked", label: "Live admin locked", confirmationMode: "DOUBLE_VALIDATION", enabled: true, scope: "LIVE", status: "WATCH" }
    ],
    providerAccess: [
      { providerId: "provider_ninjatrader_sim101", label: "NinjaTrader Sim101", access: "READ", environment: "PAPER", browserMaterialExposure: "NONE", status: "PASS" },
      { providerId: "provider_pickmytrade_shadow", label: "PickMyTrade Shadow", access: "READ", environment: "PAPER", browserMaterialExposure: "NONE", status: "WATCH" },
      { providerId: "provider_future_broker_api", label: "Future broker API", access: "DENIED", environment: "LIVE", browserMaterialExposure: "NONE", status: "BLOCK" }
    ],
    auditEvents: [
      { auditId: "audit_admin_read_0940", at: "2026-08-10T09:40:00.000Z", actorUserId: "usr_operator_alex_martin", action: "admin.view.opened", target: "/admin", status: "APPLIED", correlationId: "corr_admin_access_20260810" },
      { auditId: "audit_role_change_denied", at: "2026-08-10T09:37:30.000Z", actorUserId: "usr_operator_alex_martin", action: "admin.role.change", target: "usr_research_guest", status: "DENIED", correlationId: "corr_admin_access_20260810" },
      { auditId: "audit_settings_save", at: "2026-08-10T09:35:10.000Z", actorUserId: "usr_operator_alex_martin", action: "settings.preferences.save", target: "operator-settings", status: "ACCEPTED", commandId: "cmd_mock_settings_save", correlationId: "corr_settings_20260810" },
      { auditId: "audit_auth_refresh", at: "2026-08-10T09:34:00.000Z", actorUserId: "usr_operator_alex_martin", action: "auth.session.refresh", target: "sess_vnext_operator_20260810_085811", status: "ACCEPTED", commandId: "cmd_mock_auth_refresh", correlationId: "corr_auth_session_20260810" },
      { auditId: "audit_provider_switch_watch", at: "2026-08-10T09:31:12.000Z", actorUserId: "usr_risk_owner", action: "execution.providers.switch.requested", target: "provider_pickmytrade_shadow", status: "DENIED", correlationId: "corr_live_reconcile_cln5_20260810" }
    ],
    commandActions: [
      {
        actionId: "act_admin_export_audit",
        label: "Exporter audit",
        commandType: "admin.audit.export",
        permission: "ALLOWED",
        requiresConfirmation: false,
        criticality: "LOW",
        expectedVersion: "adminver_access_20260810_0940",
        impactSummary: "Exporte l’audit RBAC courant en lecture seule.",
        payload: { format: "jsonl", window: "today", readOnly: true }
      },
      {
        actionId: "act_admin_invite_user",
        label: "Invite user",
        commandType: "admin.user.invite",
        permission: "STEP_UP_REQUIRED",
        requiresConfirmation: true,
        criticality: "HIGH",
        expectedVersion: "adminver_access_20260810_0940",
        impactSummary: "Invite un utilisateur avec rôle viewer uniquement après step-up.",
        payload: { roleId: "role_research_viewer", accountGroupId: "grp_research_demo" }
      },
      {
        actionId: "act_admin_update_role",
        label: "Update role",
        commandType: "admin.role.update",
        permission: "STEP_UP_REQUIRED",
        requiresConfirmation: true,
        criticality: "HIGH",
        expectedVersion: "adminver_access_20260810_0940",
        impactSummary: "Change un rôle RBAC après double validation.",
        payload: { userId: "usr_research_guest", roleId: "role_research_viewer" }
      },
      {
        actionId: "act_admin_force_logout",
        label: "Force logout",
        commandType: "admin.user.force_logout",
        permission: "STEP_UP_REQUIRED",
        requiresConfirmation: true,
        criticality: "HIGH",
        expectedVersion: "adminver_access_20260810_0940",
        impactSummary: "Ferme une session utilisateur ciblée après step-up.",
        payload: { userId: "usr_legacy_operator", sessionScope: "all" }
      },
      {
        actionId: "act_admin_manage_account_group",
        label: "Manage group",
        commandType: "admin.account_group.update",
        permission: "STEP_UP_REQUIRED",
        requiresConfirmation: true,
        criticality: "HIGH",
        expectedVersion: "adminver_access_20260810_0940",
        impactSummary: "Modifie un groupe de comptes après validation admin.",
        payload: { groupId: "grp_research_demo", environment: "STAGING" }
      },
      {
        actionId: "act_admin_enable_policy",
        label: "Enable policy",
        commandType: "admin.policy.enable",
        permission: "DENIED",
        requiresConfirmation: true,
        criticality: "HIGH",
        expectedVersion: "adminver_access_20260810_0940",
        impactSummary: "Refusé pour le scope courant : Admin Viewer read-only.",
        payload: { policyId: "pol_live_locked" }
      }
    ]
  }
};

export const portfolioView: ViewEnvelope<PortfolioView> = {
  meta: commonMeta,
  permissions: commonPermissions,
  data: {
    summary: {
      equity: 124_700_000,
      grossExposureUsd: 348_600_000,
      netExposureUsd: 118_200_000,
      unrealizedPnl: 499_625,
      riskUsedPct: 37.6,
      correlatedExposurePct: 28.2,
      netLiquidation: 124_700_000,
      dailyR: 12.95,
      exposureUsd: 348_600_000,
      maxDrawdownR: -1.18,
      openPositions: 6,
      riskUsagePct: 37.6
    },
    summaryTruth: {
      equity: { state: "KNOWN", value: 124_700_000, asOf: generatedAt, source: "test-fixture" },
      grossExposureUsd: { state: "KNOWN", value: 348_600_000, asOf: generatedAt, source: "test-fixture" },
      netExposureUsd: { state: "KNOWN", value: 118_200_000, asOf: generatedAt, source: "test-fixture" },
      unrealizedPnl: { state: "KNOWN", value: 499_625, asOf: generatedAt, source: "test-fixture" },
      riskUsedPct: { state: "KNOWN", value: 37.6, asOf: generatedAt, source: "test-fixture" },
      correlatedExposurePct: { state: "KNOWN", value: 28.2, asOf: generatedAt, source: "test-fixture" }
    },
    equityCurve: [122.1, 122.6, 122.4, 123.0, 123.8, 123.4, 124.2, 124.0, 124.7],
    positions: [
      {
        positionId: "pos_demo_es",
        strategyInstanceId,
        symbol: "ESM5",
        side: "LONG",
        quantity: 15,
        virtualR: 8.6,
        brokerQuantity: 15,
        reconciliation: "MATCHED"
      },
      {
        positionId: "pos_demo_nq",
        strategyInstanceId: "strinst_mean_revert_nq_vnext_demo",
        symbol: "NQM5",
        side: "LONG",
        quantity: 18,
        virtualR: 9.2,
        brokerQuantity: 18,
        reconciliation: "MATCHED"
      }
    ],
    timeline: [
      {
        id: "evt_allocation_recalculated",
        at: "2026-08-10T07:41:14.000Z",
        title: "Allocation recalculée",
        description: "NQ cible +18"
      },
      {
        id: "evt_delta_executed",
        at: "2026-08-10T07:41:16.000Z",
        title: "Delta exécuté",
        description: "+3 NQM5"
      },
      {
        id: "evt_protection_confirmed",
        at: "2026-08-10T07:41:18.000Z",
        title: "Protection confirmée",
        description: "Stop + target"
      },
      {
        id: "evt_gap_detected",
        at: "2026-08-10T07:41:20.000Z",
        title: "Écart détecté",
        description: "CLN5 Δ -1"
      },
      {
        id: "evt_reconciliation",
        at: "2026-08-10T07:41:22.000Z",
        title: "Réconciliation",
        description: "4/5 synchro"
      },
      {
        id: "evt_snapshot_published",
        at: "2026-08-10T07:41:24.000Z",
        title: "Snapshot publié",
        description: "corr-78422"
      }
    ],
    exposureTree: [
      { id: "exp_indices", label: "Indices US", group: "Index", side: "LONG", valueUsd: 162_400_000, weightPct: 46.6 },
      { id: "exp_fx", label: "FX", group: "FX", side: "NET", valueUsd: 61_200_000, weightPct: 17.6 },
      { id: "exp_actions", label: "Actions", group: "Index", side: "NET", valueUsd: 48_700_000, weightPct: 14.0 },
      { id: "exp_energy", label: "Énergie", group: "Energy", side: "SHORT", valueUsd: 43_100_000, weightPct: 12.4 },
      { id: "exp_metals", label: "Métaux", group: "Metals", side: "NET", valueUsd: 33_200_000, weightPct: 9.5 }
    ],
    brokerPositions: [
      {
        positionId: "pos_demo_es",
        account: "Sim101",
        instrument: "ESM5",
        side: "LONG",
        quantity: 15,
        averagePrice: 5231.25,
        markPrice: 5283.25,
        unrealizedPnl: 162_325,
        riskR: 8.6,
        protectionStatus: "PROTECTED",
        reconciliationStatus: "MATCHED"
      },
      {
        positionId: "pos_demo_nq",
        account: "Sim101",
        instrument: "NQM5",
        side: "LONG",
        quantity: 18,
        averagePrice: 18150.75,
        markPrice: 18350.75,
        unrealizedPnl: 332_510,
        riskR: 9.2,
        protectionStatus: "PROTECTED",
        reconciliationStatus: "MATCHED"
      },
      {
        positionId: "pos_demo_cl",
        account: "Sim101",
        instrument: "CLN5",
        side: "SHORT",
        quantity: -20,
        averagePrice: 61.45,
        markPrice: 61.02,
        unrealizedPnl: 1_230,
        riskR: 6.1,
        protectionStatus: "PENDING",
        reconciliationStatus: "PENDING"
      },
      {
        positionId: "pos_demo_gc",
        account: "Sim101",
        instrument: "GCQ5",
        side: "LONG",
        quantity: 8,
        averagePrice: 2402.1,
        markPrice: 2418.8,
        unrealizedPnl: 9_360,
        riskR: 4.7,
        protectionStatus: "PROTECTED",
        reconciliationStatus: "MATCHED"
      },
      {
        positionId: "pos_demo_aapl",
        account: "Sim102",
        instrument: "AAPL.O",
        side: "SHORT",
        quantity: -200,
        averagePrice: 195.8,
        markPrice: 196.12,
        unrealizedPnl: -15_800,
        riskR: 3.9,
        protectionStatus: "PROTECTED",
        reconciliationStatus: "MATCHED"
      },
      {
        positionId: "pos_demo_eurusd",
        account: "Sim103",
        instrument: "EURUSD",
        side: "LONG",
        quantity: 1_000_000,
        averagePrice: 1.0792,
        markPrice: 1.08238,
        unrealizedPnl: 2_134,
        riskR: 4.7,
        protectionStatus: "PROTECTED",
        reconciliationStatus: "MATCHED"
      }
    ],
    correlationMatrix: {
      instruments: ["ES", "NQ", "CL", "GC", "EUR"],
      topPair: "ES / NQ · 0,82",
      portfolioCorrelation: 0.32,
      diversificationScore: 71,
      cells: [
        { from: "ES", to: "ES", value: 1 },
        { from: "ES", to: "NQ", value: 0.82 },
        { from: "ES", to: "CL", value: 0.18 },
        { from: "ES", to: "GC", value: -0.12 },
        { from: "ES", to: "EUR", value: 0.34 },
        { from: "NQ", to: "ES", value: 0.82 },
        { from: "NQ", to: "NQ", value: 1 },
        { from: "NQ", to: "CL", value: 0.09 },
        { from: "NQ", to: "GC", value: -0.18 },
        { from: "NQ", to: "EUR", value: 0.28 },
        { from: "CL", to: "ES", value: 0.18 },
        { from: "CL", to: "NQ", value: 0.09 },
        { from: "CL", to: "CL", value: 1 },
        { from: "CL", to: "GC", value: 0.31 },
        { from: "CL", to: "EUR", value: -0.22 },
        { from: "GC", to: "ES", value: -0.12 },
        { from: "GC", to: "NQ", value: -0.18 },
        { from: "GC", to: "CL", value: 0.31 },
        { from: "GC", to: "GC", value: 1 },
        { from: "GC", to: "EUR", value: 0.47 },
        { from: "EUR", to: "ES", value: 0.34 },
        { from: "EUR", to: "NQ", value: 0.28 },
        { from: "EUR", to: "CL", value: -0.22 },
        { from: "EUR", to: "GC", value: 0.47 },
        { from: "EUR", to: "EUR", value: 1 }
      ]
    },
    virtualAllocations: [
      {
        strategyInstanceId,
        strategyName: "AlphaBreakout PRO",
        instrument: "ESM5",
        virtualQuantity: 15,
        exposureUsd: 52_400_000,
        attributedPnlR: 162.3,
        riskPct: 8.6,
        executionMode: "LIVE",
        health: "OK"
      },
      {
        strategyInstanceId: "strinst_mean_revert_nq_vnext_demo",
        strategyName: "MeanRevert AI",
        instrument: "NQM5",
        virtualQuantity: 18,
        exposureUsd: 61_800_000,
        attributedPnlR: 332.5,
        riskPct: 9.2,
        executionMode: "LIVE",
        health: "OK"
      },
      {
        strategyInstanceId: "strinst_trendrunner_cl_vnext_demo",
        strategyName: "TrendRunner",
        instrument: "CLN5",
        virtualQuantity: -20,
        exposureUsd: 43_100_000,
        attributedPnlR: 1.23,
        riskPct: 6.1,
        executionMode: "PAPER",
        health: "WATCH"
      },
      {
        strategyInstanceId: "strinst_macro_gold_vnext_demo",
        strategyName: "Macro Gold",
        instrument: "GCQ5",
        virtualQuantity: 8,
        exposureUsd: 33_200_000,
        attributedPnlR: 9.36,
        riskPct: 4.7,
        executionMode: "LIVE",
        health: "OK"
      },
      {
        strategyInstanceId: "strinst_options_wheel_aapl_vnext_demo",
        strategyName: "Options Wheel Pro",
        instrument: "AAPL.O",
        virtualQuantity: -200,
        exposureUsd: 48_700_000,
        attributedPnlR: -15.8,
        riskPct: 3.9,
        executionMode: "PAPER",
        health: "OK"
      }
    ],
    reconciliation: {
      status: "SYNCHRO",
      targetDeskQuantity: 15,
      brokerRealQuantity: 15,
      deltaQuantity: 0,
      asOf: "2026-08-10T09:39:42.000Z",
      ordersInFlight: 0
    },
    attribution: {
      bestContributor: strategyInstanceId,
      top3RiskPct: 24.5,
      diversificationScore: 71,
      items: [
        {
          strategyInstanceId,
          label: "MeanRevert AI",
          pnlR: 332.5,
          riskPct: 82
        },
        {
          strategyInstanceId: "strinst_mean_revert_nq_vnext_demo",
          label: "AlphaBreakout PRO",
          pnlR: 162.3,
          riskPct: 58
        },
        {
          strategyInstanceId: "strinst_macro_gold_vnext_demo",
          label: "Macro Gold",
          pnlR: 9.4,
          riskPct: 24
        },
        {
          strategyInstanceId: "strinst_trendrunner_cl_vnext_demo",
          label: "TrendRunner",
          pnlR: 1.2,
          riskPct: 18
        },
        {
          strategyInstanceId: "strinst_options_wheel_aapl_vnext_demo",
          label: "Options Wheel Pro",
          pnlR: -15.8,
          riskPct: 12
        }
      ]
    }
  }
};

export const commandCenterView: ViewEnvelope<CommandCenterView> = {
  meta: commonMeta,
  permissions: commonPermissions,
  data: {
    mode: {
      environment: "PAPER",
      executionMode: "SEMI_MANUAL",
      autoExecution: "OFF",
      liveBroker: "OFF",
      release: "test-fixture",
      marketData: "FRESH"
    },
    summary: {
      deskStatus: "NOMINAL",
      activeStrategies: 7,
      activeResearchAgents: 4,
      expectedResearchAgents: 8,
      criticalIncidents: 0,
      pendingCommands: 1,
      providerSafety: "NO_BROKER_SIDE_EFFECT"
    },
    systems: [
      { id: "market-data", label: "Market Data", status: "OK", detail: "9 flux canoniques synchronisés", latencyMs: 18 },
      { id: "feature-engine", label: "Feature Engine", status: "OK", detail: "Dernier calcul il y a 12 s", latencyMs: 31 },
      { id: "strategy-runtime", label: "Strategy Runtime", status: "OK", detail: "7 instances actives", latencyMs: 24 },
      { id: "ai-workers", label: "AI Worker Service", status: "OK", detail: "4 conversations disponibles", latencyMs: 46 },
      { id: "execution-gateway", label: "Execution Gateway", status: "DEGRADED", detail: "Provider secondaire en observation", latencyMs: 63 },
      { id: "postgres", label: "PostgreSQL", status: "OK", detail: "Réplication et outbox nominales", latencyMs: 7 }
    ],
    activity: [
      { id: "act-1", time: "09:41:24", domain: "Portfolio", label: "Snapshot consolidé", detail: "5 allocations · 6 positions", duration: "42 ms", state: "DONE" },
      { id: "act-2", time: "09:41:18", domain: "Execution", label: "Réconciliation broker", detail: "CLN5 · delta −1", duration: "118 ms", state: "WATCH" },
      { id: "act-3", time: "09:40:55", domain: "Live", label: "Arbitrage signal", detail: "MNQ long · confiance 74%", duration: "1,8 s", state: "DONE" },
      { id: "act-4", time: "09:40:31", domain: "Research", label: "OOS rolling batch", detail: "Fold 18/24 en calcul", duration: "14 min", state: "RUNNING" },
      { id: "act-5", time: "09:39:52", domain: "Risk", label: "Contrôle pré-trade", detail: "14 limites validées", duration: "23 ms", state: "DONE" },
      { id: "act-6", time: "09:39:15", domain: "Jarvis", label: "Mission provider shadow", detail: "Analyse de latence en cours", duration: "6 min", state: "RUNNING" }
    ],
    risk: {
      capitalStatus: "NORMAL",
      riskUsagePct: 37.6,
      maxDrawdownR: -1.18,
      openPositions: 6,
      healthyLimits: 14,
      totalLimits: 14,
      activeAlerts: 1
    },
    lanes: [
      { id: "live-lane", label: "Chaîne Live", detail: "Bundle → décision → exécution", completed: 12, total: 12, state: "NOMINAL" },
      { id: "replay-lane", label: "Chaîne Replay", detail: "3 journées en traitement", completed: 18, total: 24, state: "NOMINAL" },
      { id: "research-lane", label: "Research Factory", detail: "1 promotion en attente", completed: 9, total: 11, state: "WATCH" },
      { id: "execution-lane", label: "Exécution & protection", detail: "1 réconciliation surveillée", completed: 4, total: 5, state: "WATCH" }
    ],
    upcoming: [
      { id: "evt-1", time: "09:45", title: "Monitor Live M15", detail: "Bundle déjà prêt", tone: "INFO" },
      { id: "evt-2", time: "10:00", title: "Publication PMI", detail: "Impact macro élevé", tone: "HIGH" },
      { id: "evt-3", time: "10:05", title: "Réconciliation provider", detail: "Contrôle PickMyTrade shadow", tone: "WATCH" },
      { id: "evt-4", time: "10:15", title: "Checkpoint recherche", detail: "OOS rolling MNQ", tone: "INFO" }
    ],
    market: { status: "FRESH", freshnessSeconds: 1, rows: [] },
    research: {
      available: false,
      hypothesisCount: null,
      experimentCount: null,
      runCount: null,
      candidateCount: null,
      activeWorkers: 4,
      expectedWorkers: 8,
      datasetCount: null,
      artifactCount: null,
      rows: []
    },
    signals: { available: false, rows: [] },
    humanGate: { available: false, rows: [] },
    provider: {
      available: false,
      mode: "DISABLED_BY_POLICY",
      circuitBreaker: "NOT_APPLICABLE_CURRENT_MODE",
      health: "DISABLED_BY_POLICY",
      ackLatencyMs: null,
      mismatchCount: null,
      events: []
    },
    performance: { available: false, pnlR: null, trades: null, maxDrawdownR: null, curve: [] },
    incidents: [],
    operations: { availability: "KNOWN", queuedTasks: 0, dlqItems: 0, staleFeeds: 0 },
    assistant: { available: false, activeWorkers: null, expectedWorkers: null, runningTasks: null, latest: [] },
    audit: []
  }
};

export const liveTradingView: ViewEnvelope<LiveTradingView> = {
  meta: commonMeta,
  permissions: commonPermissions,
  data: {
    summary: {
      signalsToday: 14,
      tradesExecuted: 3,
      acceptanceRatePct: 42,
      orderIntentsPending: 0,
      providerCommandsCreated: 0,
      providerEventsObserved: 0,
      riskUsedPct: 37.6,
      correlatedExposurePct: 28.2,
      liveDrawdownR: -1.18
    },
    session: {
      sessionId: "live_session_2026_08_10_ny",
      tradingDate: "2026-08-10",
      phase: "New York prep",
      nextMonitorAt: "2026-08-10T13:45:00.000Z",
      marketDataStatus: "LIVE"
    },
    launchGate: {
      status: "READY",
      finalDecision: "OPEN_DEMO_PAPER_AGENTS_ALLOWED",
      checkedAt: "2026-08-10T09:40:00.000Z",
      finalCheckCommand: "npm run --silent gate:demo-paper -- --json",
      releaseCheckCommand: "DESK_OPERATOR_ADMIN_PIN=... npm run --silent gate:demo-paper-release -- --json",
      components: [
        { componentId: "demo-paper", label: "Gate trading démo/PAPER", status: "READY", blockers: [] },
        { componentId: "vnext-operator", label: "Parcours opérateur VNext", status: "VERIFY_WITH_RELEASE_GATE", blockers: [] }
      ],
      checks: [
        { id: "api.ready", label: "API locale prête", ok: true, detail: "ready=true · mode=postgres", domain: "system" },
        { id: "data.live_fresh", label: "Flux MNQ/MES frais", ok: true, detail: "state=fresh · age=24s · market=2026-08-10", domain: "market-data" },
        { id: "data.source_durable", label: "Source TradingView durable", ok: true, detail: "durable=true", domain: "market-data" },
        { id: "broker.paper_environment_safe", label: "Environnement PAPER armé", ok: true, detail: "enabled=true · mode=sim101_addon_approved_only · authority=auto", domain: "broker" },
        { id: "broker.sim101_addon_ready", label: "NinjaTrader AddOn Sim101 prêt", ok: true, detail: "state=running · heartbeat=true · connection=true · command=true · account=Sim101", domain: "broker" }
      ],
      blockers: [],
      operatorActions: []
    },
    pipeline: [
      { stepId: "MARKET_DATA", label: "Market Data", status: "OK", latencyMs: 18, detail: "MNQ/MES + cross-asset frais" },
      { stepId: "FEATURE_ENGINE", label: "Feature Engine", status: "OK", latencyMs: 31, detail: "Snapshots point-in-time publiés" },
      { stepId: "STRATEGY_RUNTIME", label: "Strategy Runtime", status: "RUNNING", latencyMs: 24, detail: "7 instances actives" },
      { stepId: "SIGNAL_BUS", label: "Signal Bus", status: "RUNNING", latencyMs: 22, detail: "2 signaux arbitrables" },
      { stepId: "ARBITRATION", label: "Portfolio Arbitration", status: "OK", latencyMs: 27, detail: "Conflits corrélation filtrés" },
      { stepId: "GLOBAL_RISK", label: "Global Risk", status: "OK", latencyMs: 19, detail: "14/14 limites passées" },
      { stepId: "BROKER_NETTING", label: "Broker Netting", status: "WATCH", latencyMs: 48, detail: "CLN5 delta −1 surveillé" },
      { stepId: "ORDER_INTENT", label: "Order Intent", status: "OK", latencyMs: 15, detail: "Intentions idempotentes" },
      { stepId: "EXECUTION_GATEWAY", label: "Execution Gateway", status: "OK", latencyMs: 34, detail: "Provider primary opérationnel" },
      { stepId: "PROVIDER", label: "Provider", status: "OK", latencyMs: 41, detail: "Ninja Sim101 paper" },
      { stepId: "BROKER", label: "Broker", status: "OK", latencyMs: 52, detail: "ACK/Fills synchronisés" },
      { stepId: "RECONCILIATION", label: "Reconciliation", status: "WATCH", latencyMs: 63, detail: "1 écart non critique" }
    ],
    canonicalRuntime: {
      schemaVersion: "live_canonical_runtime_v1",
      mode: {
        environment: "PAPER",
        executionMode: "SEMI_MANUAL",
        autoExecutionEnabled: false,
        physicalExecutionEnabled: false,
        humanGateRequired: true,
        ackIsFill: false
      },
      authoritativeSources: [
        { source: "strategy_signal_outbox", rows: 2, latestAt: "2026-08-10T09:40:55.000Z" },
        { source: "portfolio_order_intent_lineage", rows: 0, latestAt: null },
        { source: "broker_provider_events", rows: 0, latestAt: null }
      ],
      freshness: {
        marketData: "LIVE",
        signalCutoffAt: "2026-08-10T09:40:55.000Z",
        contextDecisionAt: null,
        orderIntentAt: null,
        asOf: "2026-08-10T09:41:02.000Z"
      },
      pipeline: [
        { stepId: "DATA", label: "DATA", status: "OK", detail: "LIVE", source: "health.data_readiness" },
        { stepId: "STRATEGY_SIGNAL", label: "STRATEGY SIGNAL", status: "OK", detail: "2 signaux publiés", source: "strategy_signal_outbox" },
        { stepId: "HUMAN_GATE", label: "HUMAN GATE", status: "WAITING", detail: "Aucune intention en attente", source: "human_execution_gates" }
      ],
      activeStrategyInstances: [],
      latestSignals: [],
      aiContextGate: [],
      pendingOrderIntents: [],
      pendingTargetPositions: [],
      riskCenter: {
        schemaVersion: "global_risk_center_v1",
        asOf: "2026-08-10T09:41:02.000Z",
        source: "portfolio_risk_decisions",
        availability: "KNOWN",
        globalStatus: "PASS",
        killSwitch: { availability: "KNOWN", active: false, source: "broker_execution_locks", reasonCodes: [] },
        pendingOrderIntents: 0,
        pendingTargetPositions: 0,
        limits: [],
        breaches: [],
        nearestLimits: [],
        policyVersions: []
      }
    },
    signals: [
      {
        signalId,
        strategyId: "str_breakout_retest",
        strategyVersionId: "strver_breakout_retest_mnq_v4_2_0",
        strategyInstanceId,
        symbol: "MNQ",
        direction: "LONG",
        state: "ARBITRATED",
        confidence: 74,
        createdAt: "2026-08-10T09:40:55.000Z",
        expiresAt: "2026-08-10T09:55:00.000Z",
        featureSnapshotId: "features_live_mnq_20260810_0940",
        ruleHits: ["BREAKOUT_CLOSE_M15", "RETEST_ZONE_M5", "VIX_FILTER_OK"],
        expectancyR: 0.42,
        rewardRisk: 2.1,
        regime: "US_OPEN_TREND"
      },
      {
        signalId: "sig_vnext_demo_gc_macro_0935",
        strategyId: "str_gc_macro_impulse",
        strategyVersionId: "strver_gc_macro_impulse_v1_3_0",
        strategyInstanceId: "strinst_gc_macro_impulse_shadow_demo",
        symbol: "MGC",
        direction: "LONG",
        state: "NEW",
        confidence: 62,
        createdAt: "2026-08-10T09:35:00.000Z",
        expiresAt: "2026-08-10T10:05:00.000Z",
        featureSnapshotId: "features_live_mgc_20260810_0935",
        ruleHits: ["US10Y_DOWN", "DXY_DOWN", "GOLD_IMPULSE_H1"],
        expectancyR: 0.37,
        rewardRisk: 1.8,
        regime: "MACRO_IMPULSE"
      }
    ],
    arbitrations: [
      {
        arbitrationId: "arb_sig_vnext_demo_mnq_0940",
        signalId,
        decision: "ACCEPTED",
        targetQuantity: 2,
        conflictStatus: "CLEAR",
        correlationPct: 21,
        reasonCode: "PORTFOLIO_CLEAR_RISK_OK"
      },
      {
        arbitrationId: "arb_sig_vnext_demo_gc_macro_0935",
        signalId: "sig_vnext_demo_gc_macro_0935",
        decision: "SCALED",
        targetQuantity: 1,
        conflictStatus: "CORRELATED",
        correlationPct: 34,
        reasonCode: "SCALED_BY_METALS_EXPOSURE"
      }
    ],
    riskChecks: [
      { riskCheckId: "risk_sig_vnext_demo_mnq_0940", signalId, status: "PASS", limitLabel: "Per-trade risk", usedPct: 24, reasonCode: "RISK_025_NET_CAPITAL_OK" },
      { riskCheckId: "risk_corr_live_20260810", signalId, status: "WATCH", limitLabel: "Correlated exposure", usedPct: 81, reasonCode: "CORRELATED_EXPOSURE_NEAR_LIMIT" },
      { riskCheckId: "risk_daily_dd_live_20260810", signalId, status: "PASS", limitLabel: "Daily drawdown", usedPct: 33, reasonCode: "DD_WITHIN_LIMIT" }
    ],
    portfolioOrderIntents: [],
    orders: [
      {
        orderId: "ord_sig_vnext_demo_mnq_0940_001",
        signalId,
        providerId: "provider_ninjatrader_sim101",
        brokerOrderId: "nt_sim101_20260810_00031",
        symbol: "MNQ",
        side: "BUY",
        type: "LIMIT",
        quantity: 2,
        state: "ACKED",
        limitPrice: 18350.75,
        stopPrice: 18328.25,
        targetPrice: 18398.25
      },
      {
        orderId: "ord_sig_gc_macro_0935_shadow",
        signalId: "sig_vnext_demo_gc_macro_0935",
        providerId: "provider_pickmytrade_shadow",
        brokerOrderId: "shadow_gc_20260810_00004",
        symbol: "MGC",
        side: "BUY",
        type: "MARKET",
        quantity: 1,
        state: "INTENT",
        stopPrice: 2412.4,
        targetPrice: 2436.8
      }
    ],
    fills: [
      { fillId: "fill_nt_sim101_20260810_00029", orderId: "ord_prev_mean_revert_nq_001", quantity: 1, price: 18342.25, filledAt: "2026-08-10T09:33:11.000Z" },
      { fillId: "fill_nt_sim101_20260810_00030", orderId: "ord_prev_mean_revert_nq_002", quantity: 1, price: 18345.5, filledAt: "2026-08-10T09:37:42.000Z" }
    ],
    positions: [
      {
        positionId: "pos_strinst_breakout_retest_mnq_vnext_demo",
        strategyInstanceId,
        symbol: "MNQ",
        side: "LONG",
        quantity: 2,
        averagePrice: 18350.75,
        riskR: 0.24,
        pnlR: 0.18,
        protectionStatus: "PROTECTED"
      },
      {
        positionId: "pos_strinst_mean_revert_nq_vnext_demo",
        strategyInstanceId: "strinst_mean_revert_nq_vnext_demo",
        symbol: "MNQ",
        side: "LONG",
        quantity: 1,
        averagePrice: 18342.25,
        riskR: 0.18,
        pnlR: 0.31,
        protectionStatus: "PROTECTED"
      }
    ],
    providers: [
      {
        providerId: "provider_ninjatrader_sim101",
        label: "NinjaTrader Sim101",
        mode: "PAPER",
        status: "OK",
        latencyMs: 41,
        lastHeartbeatAt: "2026-08-10T09:39:58.000Z"
      },
      {
        providerId: "provider_pickmytrade_shadow",
        label: "PickMyTrade Shadow",
        mode: "SHADOW",
        status: "DEGRADED",
        latencyMs: 88,
        lastHeartbeatAt: "2026-08-10T09:39:35.000Z"
      }
    ],
    incidents: [
      {
        incidentId: "inc_live_broker_netting_cl_delta",
        severity: "MEDIUM",
        title: "Delta CLN5 non critique",
        detail: "Broker netting surveille un écart −1 sans blocage global."
      }
    ],
    timeline: [
      { eventId: "tl_market_snapshot", at: "2026-08-10T09:40:42.000Z", step: "Market Data", title: "Snapshot publié", detail: "MNQ/MES + cross-asset", tone: "INFO" },
      { eventId: "tl_signal_created", at: "2026-08-10T09:40:55.000Z", step: "Signal Bus", title: "Signal MNQ long", detail: "Breakout Retest · 74%", tone: "INFO" },
      { eventId: "tl_arbitration_ok", at: "2026-08-10T09:40:56.000Z", step: "Arbitration", title: "Arbitrage accepté", detail: "Cible 2 MNQ", tone: "INFO" },
      { eventId: "tl_risk_pass", at: "2026-08-10T09:40:57.000Z", step: "Global Risk", title: "Risk PASS", detail: "0,24 R utilisé", tone: "INFO" },
      { eventId: "tl_order_ack", at: "2026-08-10T09:40:58.000Z", step: "Execution", title: "Order ACK", detail: "Ninja Sim101", tone: "INFO" },
      { eventId: "tl_reconciliation_watch", at: "2026-08-10T09:41:02.000Z", step: "Reconciliation", title: "Delta CL surveillé", detail: "Non bloquant", tone: "WATCH" }
    ],
    timeSeriesContracts: {
      schemaVersion: "front_time_series_contracts_v1",
      view: "live-trading",
      asOf: "2026-08-10T09:41:02.000Z",
      series: [
        { seriesId: "market.ohlcv", label: "OHLCV marché", schema: "ohlcv_series_v1", source: "market_candles", availability: "UNAVAILABLE", reason: "Fixture sans série paginée.", unit: "price", sampling: "SERVER_DEFINED", maxPoints: 2000, cursor: null }
      ],
      contracts: [
        { seriesId: "market.ohlcv", label: "OHLCV marché", schema: "ohlcv_series_v1", source: "market_candles", availability: "UNAVAILABLE", reason: "Fixture sans série paginée.", unit: "price", sampling: "SERVER_DEFINED", maxPoints: 2000, cursor: null }
      ]
    },
    telegramDrilldown: {
      schemaVersion: "telegram_drilldown_front_v1",
      availability: "UNAVAILABLE",
      enabled: false,
      healthy: false,
      reason: "Fixture sans service Telegram.",
      secretsExposed: false,
      destinations: []
    },
    aiAdvisory: {
      mode: "SHADOW",
      lastContextAt: "2026-08-10T09:39:50.000Z",
      summary: "AI Context Gate observe le contexte macro en advisory uniquement ; le chemin d’ordre reste déterministe."
    }
  }
};

export const demoPaperReadinessView: ViewEnvelope<DemoPaperReadinessView> = {
  meta: commonMeta,
  permissions: commonPermissions,
  data: {
    summary: {
      status: "READY",
      finalDecision: "OPEN_DEMO_PAPER_AGENTS_ALLOWED",
      canOpenAgents: true,
      blockersCount: 0,
      nextCheckCommand: "DESK_OPERATOR_ADMIN_PIN=... npm run --silent gate:demo-paper-release -- --json",
      checkedAt: "2026-08-10T09:40:00.000Z",
      tradingDate: "2026-08-10",
      session: "ny_open"
    },
    launchGate: liveTradingView.data.launchGate,
    components: liveTradingView.data.launchGate.components,
    actionItems: [],
    marketData: {
      state: "fresh",
      marketClosed: false,
      coreAgeSeconds: 24,
      sourceDurable: true,
      effectiveMarketDate: "2026-08-10",
      freshnessPolicy: { max_age_seconds: 900, reason: "inside_cme_globex_session" },
      coreFeeds: [
        { instrument: "MNQ", timeframe: "1", latestTimestampUtc: "2026-08-10T09:39:00.000Z", latestReceivedAtUtc: "2026-08-10T09:39:05.000Z", classification: "durable_alert", durable: true, source: "tradingview_alert_webhook", alertId: "mnq-m1" },
        { instrument: "MNQ", timeframe: "5", latestTimestampUtc: "2026-08-10T09:35:00.000Z", latestReceivedAtUtc: "2026-08-10T09:35:05.000Z", classification: "durable_alert", durable: true, source: "tradingview_alert_webhook", alertId: "mnq-m5" },
        { instrument: "MES", timeframe: "1", latestTimestampUtc: "2026-08-10T09:39:00.000Z", latestReceivedAtUtc: "2026-08-10T09:39:05.000Z", classification: "durable_alert", durable: true, source: "tradingview_alert_webhook", alertId: "mes-m1" },
        { instrument: "MES", timeframe: "5", latestTimestampUtc: "2026-08-10T09:35:00.000Z", latestReceivedAtUtc: "2026-08-10T09:35:05.000Z", classification: "durable_alert", durable: true, source: "tradingview_alert_webhook", alertId: "mes-m5" }
      ]
    },
    broker: {
      accountName: "Sim101",
      sim101Account: true,
      startupState: "running",
      loginRequired: false,
      connectionReady: true,
      addonHeartbeatFresh: true,
      addonConnected: true,
      commandEnabled: true,
      addonStatus: "armed",
      executionAuthorityMode: "auto",
      entryOperatorApprovalRequired: false
    },
    commands: {
      releaseGate: "DESK_OPERATOR_ADMIN_PIN=... npm run --silent gate:demo-paper-release -- --json",
      tradingGate: "npm run --silent gate:demo-paper -- --json",
      doctor: "npm run --silent doctor:demo-paper -- --json --exit-zero",
      tradingViewDoctor: "npm run --silent doctor:tradingview -- --json --exit-zero"
    },
    links: [
      { label: "Live Trading", route: "/live", reason: "Voir pipeline et signaux live." },
      { label: "Execution Providers", route: "/execution/providers", reason: "Contrôler Simulation/Sim101 et providers." },
      { label: "Incidents", route: "/execution/incidents", reason: "Traiter DLQ et incidents broker." },
      { label: "Event Explorer", route: "/events", reason: "Lire les preuves et événements système." }
    ]
  }
};

export const liveSignalDetailView: ViewEnvelope<LiveSignalDetailView> = {
  meta: commonMeta,
  permissions: commonPermissions,
  data: {
    summary: {
      signalScore: 84,
      timeToExpirySec: 918,
      acceptanceProbabilityPct: 76,
      targetQuantity: 2,
      riskUsedPct: 24,
      conflictCount: 1
    },
    identity: {
      signalId,
      strategyId: "str_breakout_retest",
      strategyDefinitionId: "strdef_breakout_retest_mnq",
      strategyVersionId: "strver_breakout_retest_mnq_v4_2_0",
      strategyInstanceId,
      runtimeBundleId: "rtbundle_breakout_retest_mnq_v4_2_0_paper",
      sessionId: "live_session_2026_08_10_ny",
      correlationId: "corr_live_reconcile_cln5_20260810",
      featureSnapshotId: "features_live_mnq_20260810_0940",
      expectedVersion: "sigver_sig_vnext_demo_mnq_0940_0003"
    },
    signal: {
      symbol: "MNQ",
      direction: "LONG",
      state: "ARBITRATED",
      generatedAt: "2026-08-10T09:40:55.000Z",
      expiresAt: "2026-08-10T09:55:00.000Z",
      confidence: 74,
      expectancyR: 0.42,
      rewardRisk: 2.1,
      regime: "US_OPEN_TREND",
      entryZoneLow: 18347.5,
      entryZoneHigh: 18352.25,
      stopPrice: 18328.25,
      targetPrice: 18398.25
    },
    predicates: [
      {
        predicateId: "pred_breakout_close_m15",
        label: "Breakout close M15",
        enumCode: "BREAKOUT_CLOSE_ABOVE_RANGE",
        observedValue: "close 18 348,75 > range high 18 344,50",
        threshold: "range high + 3 ticks",
        status: "PASS",
        sourceFeatureId: "feat_mnq_m15_structure"
      },
      {
        predicateId: "pred_retest_zone_m5",
        label: "Retest zone M5",
        enumCode: "RETEST_ZONE_CONFIRMED",
        observedValue: "low 18 347,50 dans zone",
        threshold: "18 347,50–18 352,25",
        status: "PASS",
        sourceFeatureId: "feat_mnq_m5_retest"
      },
      {
        predicateId: "pred_vix_filter",
        label: "VIX filter",
        enumCode: "CROSS_ASSET_VOL_FILTER_OK",
        observedValue: "VIX −1,8% intraday",
        threshold: "VIX non accélérant",
        status: "PASS",
        sourceFeatureId: "feat_vix_intraday_delta"
      },
      {
        predicateId: "pred_correlation_budget",
        label: "Correlation budget",
        enumCode: "PORTFOLIO_CORRELATION_WATCH",
        observedValue: "MNQ/MES exposure 28%",
        threshold: "< 35%",
        status: "WATCH",
        sourceFeatureId: "feat_portfolio_corr_mnq_mes"
      }
    ],
    featureSnapshot: {
      featureSnapshotId: "features_live_mnq_20260810_0940",
      datasetId: "dataset_live_nq_es_cross_asset_20260810_0940",
      cutoffAt: "2026-08-10T09:40:00.000Z",
      hash: "sha256:7f4b1e9a5c91a44c",
      pointInTime: true,
      freshness: "FRESH",
      items: [
        { featureId: "feat_mnq_m15_structure", label: "MNQ structure M15", value: "breakout confirmed", source: "TradingView MCP", quality: "OK" },
        { featureId: "feat_mnq_m5_retest", label: "MNQ retest M5", value: "zone touched", source: "TradingView MCP", quality: "OK" },
        { featureId: "feat_vix_intraday_delta", label: "VIX intraday", value: "−1,8%", source: "pack cross-asset", quality: "OK" },
        { featureId: "feat_us10y_us02y", label: "US rates", value: "10Y down / 2Y flat", source: "pack macro", quality: "OK" },
        { featureId: "feat_mega_caps_breadth", label: "Megacaps breadth", value: "5/7 positive", source: "pack equities", quality: "WATCH" }
      ]
    },
    context: [
      { contextId: "ctx_nasdaq_breadth", label: "Nasdaq breadth", value: "Megacaps 5/7 vertes", interpretation: "soutien directionnel au signal MNQ", tone: "POSITIVE" },
      { contextId: "ctx_dxy", label: "DXY", value: "−0,22%", interpretation: "vent arrière risque US", tone: "POSITIVE" },
      { contextId: "ctx_rates", label: "US10Y/US02Y", value: "10Y en détente", interpretation: "pas de stress taux immédiat", tone: "NEUTRAL" },
      { contextId: "ctx_cl_delta", label: "CLN5 netting", value: "delta −1 broker", interpretation: "incident execution non bloquant pour MNQ", tone: "WATCH" }
    ],
    conflicts: [
      {
        conflictId: "conf_corr_mnq_mes_existing",
        kind: "CORRELATION",
        targetId: "strinst_mean_revert_nq_vnext_demo",
        label: "Exposition déjà longue MNQ",
        severity: "MEDIUM",
        resolution: "WATCH"
      }
    ],
    existingPositions: [
      {
        positionId: "pos_strinst_mean_revert_nq_vnext_demo",
        strategyInstanceId: "strinst_mean_revert_nq_vnext_demo",
        symbol: "MNQ",
        side: "LONG",
        quantity: 1,
        averagePrice: 18342.25,
        pnlR: 0.31,
        riskR: 0.18
      }
    ],
    arbitration: {
      arbitrationId: "arb_sig_vnext_demo_mnq_0940",
      decision: "ACCEPTED",
      targetQuantity: 2,
      conflictStatus: "CLEAR",
      correlationPct: 21,
      reasonCode: "PORTFOLIO_CLEAR_RISK_OK",
      portfolioRoute: "/portfolio"
    },
    riskCheck: {
      riskCheckId: "risk_sig_vnext_demo_mnq_0940",
      status: "PASS",
      limitLabel: "Per-trade risk",
      usedPct: 24,
      reasonCode: "RISK_025_NET_CAPITAL_OK",
      maxRiskPct: 0.25,
      netCapital: 124_700_000,
      targetRiskR: 0.24,
      roundedQuantity: 2
    },
    linkedOrders: [
      {
        orderId: "ord_sig_vnext_demo_mnq_0940_001",
        providerId: "provider_ninjatrader_sim101",
        brokerOrderId: "nt_sim101_20260810_00031",
        side: "BUY",
        type: "LIMIT",
        quantity: 2,
        state: "ACKED",
        limitPrice: 18350.75,
        stopPrice: 18328.25,
        targetPrice: 18398.25
      }
    ],
    auditTrail: [
      { eventId: "evt_strategy_runtime_signal", at: "2026-08-10T09:40:55.000Z", domain: "STRATEGY", lane: "AUTHORITATIVE", title: "Signal déterministe créé", route: "/events" },
      { eventId: "evt_ai_context_advisory_created", at: "2026-08-10T09:40:55.240Z", domain: "JARVIS", lane: "ADVISORY", title: "AI advisory attaché", route: "/jarvis" },
      { eventId: "evt_portfolio_arbitration_completed", at: "2026-08-10T09:40:56.000Z", domain: "PORTFOLIO", lane: "AUTHORITATIVE", title: "Portfolio Arbitration accepté", route: "/portfolio" },
      { eventId: "evt_global_risk_passed", at: "2026-08-10T09:40:56.220Z", domain: "RISK", lane: "AUTHORITATIVE", title: "Global Risk PASS", route: "/risk" },
      { eventId: "evt_order_intent_created", at: "2026-08-10T09:40:57.040Z", domain: "EXECUTION", lane: "AUTHORITATIVE", title: "Order Intent créé", route: "/orders" },
      { eventId: "evt_provider_order_ack", at: "2026-08-10T09:40:58.260Z", domain: "EXECUTION", lane: "AUTHORITATIVE", title: "Provider ACK", route: "/execution/providers" }
    ],
    aiAdvisory: {
      mode: "SHADOW",
      lastContextAt: "2026-08-10T09:39:50.000Z",
      summary: "Contexte macro favorable mais l'avis IA reste non autoritaire ; seule la chaîne Risk/Portfolio décide.",
      authority: "NONE",
      recommendation: "TAKE"
    },
    navigation: [
      { label: "Fiche stratégie", route: "/strategies/str_breakout_retest", kind: "STRATEGY" },
      { label: "Portfolio", route: "/portfolio", kind: "PORTFOLIO" },
      { label: "Event Explorer", route: "/events", kind: "EVENTS" },
      { label: "Ordres liés", route: "/orders", kind: "ORDERS" },
      { label: "Risk Center", route: "/risk", kind: "RISK" }
    ],
    commandActions: [
      {
        actionId: "act_signal_take_full",
        label: "TAKE full",
        commandType: "live.signal.operator_decision",
        decision: "TAKE",
        permission: "ALLOWED",
        requiresConfirmation: true,
        capability: "live.signal.command",
        payload: { targetQuantity: 2, decision: "TAKE" }
      },
      {
        actionId: "act_signal_take_reduced",
        label: "TAKE reduced",
        commandType: "live.signal.operator_decision",
        decision: "TAKE_REDUCED",
        permission: "ALLOWED",
        requiresConfirmation: true,
        capability: "live.signal.command",
        payload: { targetQuantity: 1, decision: "TAKE_REDUCED" }
      },
      {
        actionId: "act_signal_wait",
        label: "WAIT",
        commandType: "live.signal.operator_decision",
        decision: "WAIT",
        permission: "ALLOWED",
        requiresConfirmation: true,
        capability: "live.signal.command",
        payload: { targetQuantity: 0, decision: "WAIT" }
      },
      {
        actionId: "act_signal_reject",
        label: "REJECT",
        commandType: "live.signal.operator_decision",
        decision: "REJECT",
        permission: "STEP_UP_REQUIRED",
        requiresConfirmation: true,
        capability: "live.signal.command",
        payload: { targetQuantity: 0, decision: "REJECT", requiresStepUp: true }
      }
    ]
  }
};

export const ordersView: ViewEnvelope<OrdersView> = {
  meta: commonMeta,
  permissions: commonPermissions,
  data: {
    summary: {
      orderIntents: 4,
      activeOrders: 2,
      recentFills: 2,
      partialOrders: 1,
      rejectedOrders: 1,
      protectedOrdersPct: 75
    },
    filters: {
      activeTab: "ACTIVE",
      stateCounts: {
        INTENT: 1,
        ACKED: 1,
        PARTIAL: 1,
        FILLED: 2,
        CANCELLED: 1,
        REJECTED: 1
      },
      providerCounts: {
        provider_ninjatrader_sim101: 2,
        provider_pickmytrade_shadow: 1
      }
    },
    orderIntents: [
      {
        orderIntentId: "oint_sig_vnext_demo_mnq_0940_001",
        signalId,
        orderId: "ord_sig_vnext_demo_mnq_0940_001",
        strategyInstanceId,
        account: "Sim101",
        instrument: "MNQ",
        side: "BUY",
        quantity: 2,
        type: "LIMIT",
        tif: "DAY",
        limitPrice: 18350.75,
        stopPrice: 18328.25,
        targetPrice: 18398.25,
        providerId: "provider_ninjatrader_sim101",
        state: "ACKED",
        idempotencyKey: "idem_order_intent_mnq_0940_001",
        correlationId: "corr_live_reconcile_cln5_20260810",
        createdAt: "2026-08-10T09:40:57.040Z",
        expectedVersion: "orderver_ord_sig_vnext_demo_mnq_0940_001_0002"
      },
      {
        orderIntentId: "oint_sig_gc_macro_0935_shadow",
        signalId: "sig_vnext_demo_gc_macro_0935",
        orderId: "ord_sig_gc_macro_0935_shadow",
        strategyInstanceId: "strinst_gc_macro_impulse_shadow_demo",
        account: "shadow",
        instrument: "MGC",
        side: "BUY",
        quantity: 1,
        type: "MARKET",
        tif: "DAY",
        stopPrice: 2412.4,
        targetPrice: 2436.8,
        providerId: "provider_pickmytrade_shadow",
        state: "CREATED",
        idempotencyKey: "idem_order_intent_gc_0935_shadow",
        correlationId: "corr_gc_macro_shadow_20260810",
        createdAt: "2026-08-10T09:35:07.000Z",
        expectedVersion: "orderver_ord_sig_gc_macro_0935_shadow_0001"
      }
    ],
    activeOrders: [
      {
        orderId: "ord_sig_vnext_demo_mnq_0940_001",
        orderIntentId: "oint_sig_vnext_demo_mnq_0940_001",
        signalId,
        providerId: "provider_ninjatrader_sim101",
        brokerOrderId: "nt_sim101_20260810_00031",
        strategyInstanceId,
        account: "Sim101",
        instrument: "MNQ",
        side: "BUY",
        quantity: 2,
        remainingQuantity: 2,
        type: "LIMIT",
        tif: "DAY",
        state: "ACKED",
        limitPrice: 18350.75,
        stopPrice: 18328.25,
        targetPrice: 18398.25,
        commissions: 0,
        slippageR: 0,
        protectionStatus: "PROTECTED",
        idempotencyKey: "idem_order_intent_mnq_0940_001",
        correlationId: "corr_live_reconcile_cln5_20260810",
        updatedAt: "2026-08-10T09:40:58.260Z",
        expectedVersion: "orderver_ord_sig_vnext_demo_mnq_0940_001_0002"
      },
      {
        orderId: "ord_sig_gc_macro_0935_shadow",
        orderIntentId: "oint_sig_gc_macro_0935_shadow",
        signalId: "sig_vnext_demo_gc_macro_0935",
        providerId: "provider_pickmytrade_shadow",
        brokerOrderId: "shadow_gc_20260810_00004",
        strategyInstanceId: "strinst_gc_macro_impulse_shadow_demo",
        account: "shadow",
        instrument: "MGC",
        side: "BUY",
        quantity: 1,
        remainingQuantity: 1,
        type: "MARKET",
        tif: "DAY",
        state: "INTENT",
        stopPrice: 2412.4,
        targetPrice: 2436.8,
        commissions: 0,
        slippageR: 0,
        protectionStatus: "PENDING",
        idempotencyKey: "idem_order_intent_gc_0935_shadow",
        correlationId: "corr_gc_macro_shadow_20260810",
        updatedAt: "2026-08-10T09:35:07.000Z",
        expectedVersion: "orderver_ord_sig_gc_macro_0935_shadow_0001"
      }
    ],
    fills: [
      {
        fillId: "fill_nt_sim101_20260810_00029",
        orderId: "ord_prev_mean_revert_nq_001",
        providerId: "provider_ninjatrader_sim101",
        brokerExecutionId: "exec_nt_sim101_00029",
        instrument: "MNQ",
        quantity: 1,
        price: 18342.25,
        commission: 1.24,
        slippageR: 0.02,
        filledAt: "2026-08-10T09:33:11.000Z"
      },
      {
        fillId: "fill_nt_sim101_20260810_00030",
        orderId: "ord_prev_mean_revert_nq_002",
        providerId: "provider_ninjatrader_sim101",
        brokerExecutionId: "exec_nt_sim101_00030",
        instrument: "MNQ",
        quantity: 1,
        price: 18345.5,
        commission: 1.24,
        slippageR: -0.01,
        filledAt: "2026-08-10T09:37:42.000Z"
      }
    ],
    protections: [
      {
        protectionId: "prot_ord_sig_vnext_demo_mnq_0940_001",
        orderId: "ord_sig_vnext_demo_mnq_0940_001",
        stopOrderId: "stp_ord_sig_vnext_demo_mnq_0940_001",
        targetOrderId: "tgt_ord_sig_vnext_demo_mnq_0940_001",
        state: "ATTACHED",
        stopPrice: 18328.25,
        targetPrice: 18398.25,
        trailingModel: "MFE_AFTER_1R",
        reasonCode: "BRACKET_ATTACHED_ON_ACK"
      },
      {
        protectionId: "prot_ord_sig_gc_macro_0935_shadow",
        orderId: "ord_sig_gc_macro_0935_shadow",
        state: "PENDING",
        stopPrice: 2412.4,
        targetPrice: 2436.8,
        trailingModel: "SHADOW_NO_BROKER_SUBMIT",
        reasonCode: "SHADOW_PROVIDER_NO_LIVE_PROTECTION"
      }
    ],
    providers: [
      {
        providerId: "provider_ninjatrader_sim101",
        label: "NinjaTrader Sim101",
        mode: "PAPER",
        status: "OK",
        activeOrders: 1,
        lastAckLatencyMs: 750,
        lastHeartbeatAt: "2026-08-10T09:39:58.000Z"
      },
      {
        providerId: "provider_pickmytrade_shadow",
        label: "PickMyTrade Shadow",
        mode: "SHADOW",
        status: "DEGRADED",
        activeOrders: 1,
        lastAckLatencyMs: 0,
        lastHeartbeatAt: "2026-08-10T09:39:35.000Z"
      }
    ],
    stateMachine: [
      { state: "INTENT", count: 1, description: "OrderIntent créé mais non envoyé broker.", tone: "WATCH" },
      { state: "ACKED", count: 1, description: "Provider ACK, protection attachée.", tone: "OK" },
      { state: "PARTIAL", count: 1, description: "Fill partiel sous surveillance.", tone: "WATCH" },
      { state: "REJECTED", count: 1, description: "Rejet archivé et DLQ opérable.", tone: "BLOCK" }
    ],
    history: [
      {
        eventId: "evt_order_intent_created",
        at: "2026-08-10T09:40:57.040Z",
        orderId: "ord_sig_vnext_demo_mnq_0940_001",
        title: "Order Intent créé",
        detail: "MNQ BUY 2 LIMIT · idem_order_intent_mnq_0940_001",
        route: "/events",
        correlationId: "corr_live_reconcile_cln5_20260810"
      },
      {
        eventId: "evt_execution_gateway_accepted",
        at: "2026-08-10T09:40:57.510Z",
        orderId: "ord_sig_vnext_demo_mnq_0940_001",
        title: "Execution Gateway accepté",
        detail: "Permission PAPER validée, provider primaire.",
        route: "/execution/providers",
        correlationId: "corr_live_reconcile_cln5_20260810"
      },
      {
        eventId: "evt_provider_order_ack",
        at: "2026-08-10T09:40:58.260Z",
        orderId: "ord_sig_vnext_demo_mnq_0940_001",
        title: "Provider ACK",
        detail: "nt_sim101_20260810_00031",
        route: "/execution/providers",
        correlationId: "corr_live_reconcile_cln5_20260810"
      }
    ],
    commandActions: [
      {
        actionId: "act_order_cancel_mnq_0940",
        label: "Annuler ordre",
        commandType: "orders.cancel",
        targetOrderId: "ord_sig_vnext_demo_mnq_0940_001",
        permission: "ALLOWED",
        requiresConfirmation: true,
        criticality: "MEDIUM",
        expectedVersion: "orderver_ord_sig_vnext_demo_mnq_0940_001_0002",
        payload: { orderId: "ord_sig_vnext_demo_mnq_0940_001", providerId: "provider_ninjatrader_sim101" }
      },
      {
        actionId: "act_order_replace_mnq_0940",
        label: "Replace prix",
        commandType: "orders.replace",
        targetOrderId: "ord_sig_vnext_demo_mnq_0940_001",
        permission: "STEP_UP_REQUIRED",
        requiresConfirmation: true,
        criticality: "HIGH",
        expectedVersion: "orderver_ord_sig_vnext_demo_mnq_0940_001_0002",
        payload: { orderId: "ord_sig_vnext_demo_mnq_0940_001", newLimitPrice: 18349.75, providerId: "provider_ninjatrader_sim101" }
      },
      {
        actionId: "act_order_close_reduce_mnq",
        label: "Clôturer / réduire",
        commandType: "orders.close_reduce",
        targetOrderId: "ord_sig_vnext_demo_mnq_0940_001",
        permission: "DENIED",
        requiresConfirmation: true,
        criticality: "HIGH",
        expectedVersion: "orderver_ord_sig_vnext_demo_mnq_0940_001_0002",
        payload: { orderId: "ord_sig_vnext_demo_mnq_0940_001", reduceQuantity: 1, reasonCode: "NO_FILLED_POSITION_YET" }
      },
      {
        actionId: "act_orders_reconcile_provider",
        label: "Réconcilier provider",
        commandType: "orders.reconcile",
        targetProviderId: "provider_ninjatrader_sim101",
        permission: "ALLOWED",
        requiresConfirmation: true,
        criticality: "LOW",
        expectedVersion: "providerver_ninjatrader_sim101_20260810_0940",
        payload: { providerId: "provider_ninjatrader_sim101", correlationId: "corr_live_reconcile_cln5_20260810" }
      }
    ]
  }
};

export const riskView: ViewEnvelope<RiskView> = {
  meta: commonMeta,
  permissions: commonPermissions,
  data: {
    summary: {
      globalStatus: "WATCH",
      riskUsedPct: 37.6,
      dailyLossR: -0.42,
      dailyLossLimitR: -3,
      maxDrawdownR: -1.18,
      trailingDrawdownR: -2.4,
      grossExposureUsd: 348_600_000,
      netExposureUsd: 118_200_000,
      leverage: 2.8,
      activeBreaches: 1,
      stressTestsToday: 3
    },
    limits: [
      {
        limitId: "risklim_global_portfolio_used_20260810",
        scope: "GLOBAL",
        label: "Budget global portefeuille",
        targetId: "portfolio_global",
        limitValue: 150_000_000,
        usedValue: 56_300_000,
        unit: "USD",
        usedPct: 37.6,
        headroomValue: 93_700_000,
        status: "PASS",
        reasonCodes: ["PORTFOLIO_RISK_BUDGET_OK", "NO_LOCAL_FRONT_CALC"],
        lastChangedAt: "2026-08-10T09:30:00.000Z",
        changedBy: "global-risk-engine",
        officialSource: "risk_limit_snapshot_20260810_0940",
        contributors: [
          { contributorId: strategyInstanceId, label: "AlphaBreakout PRO", contributionValue: 8.6, contributionPct: 22.9, route: "/strategies/str_breakout_retest" },
          { contributorId: "strinst_mean_revert_nq_vnext_demo", label: "MeanRevert AI", contributionValue: 9.2, contributionPct: 24.5, route: "/portfolio" },
          { contributorId: "strinst_trendrunner_cl_vnext_demo", label: "TrendRunner CL", contributionValue: 6.1, contributionPct: 16.2, route: "/portfolio" }
        ]
      },
      {
        limitId: "risklim_signal_mnq_trade_025",
        scope: "STRATEGY",
        label: "Per-trade risk · MNQ breakout",
        targetId: strategyInstanceId,
        limitValue: 0.25,
        usedValue: 0.24,
        unit: "PCT",
        usedPct: 96,
        headroomValue: 0.01,
        status: "WATCH",
        reasonCodes: ["RISK_025_NET_CAPITAL_OK", "HEADROOM_TIGHT"],
        lastChangedAt: "2026-08-10T09:40:56.220Z",
        changedBy: "risk_sig_vnext_demo_mnq_0940",
        officialSource: "risk_sig_vnext_demo_mnq_0940",
        contributors: [
          { contributorId: signalId, label: "Signal MNQ 09:40", contributionValue: 0.24, contributionPct: 96, route: `/live/signals/${signalId}` },
          { contributorId: "ord_sig_vnext_demo_mnq_0940_001", label: "OrderIntent MNQ", contributionValue: 2, contributionPct: 100, route: "/orders" }
        ]
      },
      {
        limitId: "risklim_corr_es_nq",
        scope: "ASSET_CLASS",
        label: "Corrélation ES/NQ",
        targetId: "INDEX",
        limitValue: 0.85,
        usedValue: 0.82,
        unit: "PCT",
        usedPct: 96.5,
        headroomValue: 0.03,
        status: "WATCH",
        reasonCodes: ["CORRELATED_EXPOSURE_NEAR_LIMIT", "INDEX_CLUSTER_DOMINANT"],
        lastChangedAt: "2026-08-10T09:38:22.000Z",
        changedBy: "portfolio-correlation-engine",
        officialSource: "portfolio_correlation_snapshot_20260810_0940",
        contributors: [
          { contributorId: "ES", label: "ES exposure", contributionValue: 52_400_000, contributionPct: 43, route: "/portfolio" },
          { contributorId: "NQ", label: "NQ/MNQ exposure", contributionValue: 61_800_000, contributionPct: 57, route: "/portfolio" }
        ]
      },
      {
        limitId: "risklim_prop_daily_loss_sim101",
        scope: "PROP_FIRM",
        label: "Daily loss Sim101/proxy prop",
        targetId: "Sim101",
        limitValue: -3,
        usedValue: -0.42,
        unit: "R",
        usedPct: 14,
        headroomValue: 2.58,
        status: "PASS",
        reasonCodes: ["DAILY_LOSS_WITHIN_LIMIT", "RESET_22H_PARIS"],
        lastChangedAt: "2026-08-10T09:39:00.000Z",
        changedBy: "prop-constraint-engine",
        officialSource: "prop_constraint_snapshot_20260810_0940",
        contributors: [
          { contributorId: "fill_nt_sim101_20260810_00029", label: "Fill MNQ 09:33", contributionValue: 0.02, contributionPct: 5, route: "/orders" },
          { contributorId: "fill_nt_sim101_20260810_00030", label: "Fill MNQ 09:37", contributionValue: -0.01, contributionPct: 2, route: "/orders" }
        ]
      }
    ],
    exposures: [
      { exposureId: "expo_index_us", assetClass: "INDEX", grossUsd: 168_900_000, netUsd: 72_500_000, longUsd: 121_100_000, shortUsd: 48_600_000, usedPct: 64, status: "WATCH", topInstrument: "MNQ" },
      { exposureId: "expo_energy", assetClass: "ENERGY", grossUsd: 43_100_000, netUsd: -21_400_000, longUsd: 10_850_000, shortUsd: 32_250_000, usedPct: 38, status: "PASS", topInstrument: "CLN5" },
      { exposureId: "expo_metals", assetClass: "METALS", grossUsd: 33_200_000, netUsd: 18_900_000, longUsd: 26_050_000, shortUsd: 7_150_000, usedPct: 31, status: "PASS", topInstrument: "GCQ5" },
      { exposureId: "expo_fx_rates", assetClass: "FX", grossUsd: 21_700_000, netUsd: 8_100_000, longUsd: 14_900_000, shortUsd: 6_800_000, usedPct: 22, status: "PASS", topInstrument: "EUR" }
    ],
    correlations: [
      { correlationId: "corrpair_es_nq_20260810", pair: "ES/NQ", value: 0.82, limit: 0.85, status: "WATCH", reasonCode: "INDEX_CLUSTER_DOMINANT", contributors: [strategyInstanceId, "strinst_mean_revert_nq_vnext_demo"] },
      { correlationId: "corrpair_gc_fx_20260810", pair: "GC/EUR", value: 0.47, limit: 0.7, status: "PASS", reasonCode: "METALS_FX_WITHIN_RANGE", contributors: ["strinst_macro_gold_vnext_demo"] },
      { correlationId: "corrpair_cl_index_20260810", pair: "CL/NQ", value: 0.09, limit: 0.55, status: "PASS", reasonCode: "ENERGY_UNCORRELATED", contributors: ["strinst_trendrunner_cl_vnext_demo"] }
    ],
    propConstraints: [
      { constraintId: "prop_daily_loss_sim101", label: "Daily loss", rule: "Max −3.00 R par journée", usedValue: -0.42, limitValue: -3, unit: "R", status: "PASS", provider: "Sim101 proxy", nextResetAt: "2026-08-10T22:00:00.000Z" },
      { constraintId: "prop_trailing_dd_sim101", label: "Trailing drawdown", rule: "Stop si drawdown trailing < −2.40 R", usedValue: -1.18, limitValue: -2.4, unit: "R", status: "WATCH", provider: "Sim101 proxy", nextResetAt: "2026-08-11T00:00:00.000Z" },
      { constraintId: "prop_max_size_mnq", label: "MNQ max lots", rule: "Max 4 lots MNQ par stratégie", usedValue: 2, limitValue: 4, unit: "LOTS", status: "PASS", provider: "Global Risk", nextResetAt: "2026-08-10T22:00:00.000Z" }
    ],
    stressTests: [
      { stressTestId: "stress_gap_down_index_20260810_0940", scenario: "Index gap −1.25%", state: "PASSED", lossR: -1.42, lossUsd: -42_600, marginUsedPct: 46, tailRiskPct: 4.2, completedAt: "2026-08-10T09:39:30.000Z", route: "/risk" },
      { stressTestId: "stress_rates_spike_20260810_0940", scenario: "US10Y +18 bps", state: "PASSED", lossR: -0.72, lossUsd: -21_900, marginUsedPct: 41, tailRiskPct: 2.9, completedAt: "2026-08-10T09:39:34.000Z", route: "/risk" },
      { stressTestId: "stress_volatility_expansion_live", scenario: "VIX +4 pts / NQ spread ×2", state: "RUNNING", lossR: -1.88, lossUsd: -56_300, marginUsedPct: 52, tailRiskPct: 6.4, route: "/risk" }
    ],
    breaches: [
      {
        breachId: "breach_corr_es_nq_watch_20260810",
        limitId: "risklim_corr_es_nq",
        severity: "MEDIUM",
        status: "OPEN",
        title: "Corrélation ES/NQ proche limite",
        detail: "0.82 contre limite 0.85 ; nouvelles positions index doivent passer par scaling ou WAIT.",
        openedAt: "2026-08-10T09:38:22.000Z",
        route: "/events",
        correlationId: "corr_live_reconcile_cln5_20260810"
      },
      {
        breachId: "breach_trailing_dd_watch_20260810",
        limitId: "prop_trailing_dd_sim101",
        severity: "LOW",
        status: "ACKED",
        title: "Trailing drawdown sous surveillance",
        detail: "Drawdown −1.18 R, seuil proxy −2.40 R.",
        openedAt: "2026-08-10T09:21:00.000Z",
        acknowledgedBy: "operator",
        route: "/events",
        correlationId: "corr_live_reconcile_cln5_20260810"
      }
    ],
    commandActions: [
      {
        actionId: "act_risk_run_stress_index",
        label: "Lancer stress test",
        commandType: "risk.stress_test.run",
        permission: "ALLOWED",
        requiresConfirmation: true,
        criticality: "MEDIUM",
        expectedVersion: "riskver_global_20260810_0940",
        impactSummary: "Démarre un recalcul non-broker sur les scénarios index/rates/vol.",
        payload: { scenarioSet: "LIVE_CORE", correlationId: "corr_vnext_demo_20260810_0940" }
      },
      {
        actionId: "act_risk_modify_limit_mnq",
        label: "Modifier limite",
        commandType: "risk.limit.modify",
        permission: "STEP_UP_REQUIRED",
        requiresConfirmation: true,
        criticality: "HIGH",
        expectedVersion: "riskver_global_20260810_0940",
        impactSummary: "Prépare une demande de baisse temporaire du per-trade MNQ à 0.20%.",
        payload: { limitId: "risklim_signal_mnq_trade_025", proposedLimitValue: 0.2, unit: "PCT" }
      },
      {
        actionId: "act_risk_reduce_allocation_mnq",
        label: "Réduire allocation",
        commandType: "risk.allocation.reduce",
        permission: "ALLOWED",
        requiresConfirmation: true,
        criticality: "HIGH",
        expectedVersion: "riskver_global_20260810_0940",
        impactSummary: "Réduit l’allocation cible MNQ breakout à 50% avant prochain ordre.",
        payload: { strategyInstanceId, reductionPct: 50, limitId: "risklim_signal_mnq_trade_025" }
      },
      {
        actionId: "act_risk_suspend_strategy",
        label: "Suspendre stratégie",
        commandType: "risk.strategy.suspend",
        permission: "STEP_UP_REQUIRED",
        requiresConfirmation: true,
        criticality: "HIGH",
        expectedVersion: "riskver_global_20260810_0940",
        impactSummary: "Met l’instance MNQ breakout en pause ; aucune position broker n’est clôturée directement.",
        payload: { strategyInstanceId, reasonCode: "CORRELATED_EXPOSURE_NEAR_LIMIT" }
      },
      {
        actionId: "act_risk_disable_mgc",
        label: "Désactiver MGC",
        commandType: "risk.instrument.disable",
        permission: "DENIED",
        requiresConfirmation: true,
        criticality: "HIGH",
        expectedVersion: "riskver_global_20260810_0940",
        impactSummary: "Action refusée : l’instrument MGC est en shadow provider et ne peut pas être désactivé par cet opérateur.",
        payload: { instrument: "MGC", providerId: "provider_pickmytrade_shadow" }
      },
      {
        actionId: "act_risk_ack_breach_corr",
        label: "Acquitter alerte",
        commandType: "risk.breach.ack",
        permission: "ALLOWED",
        requiresConfirmation: false,
        criticality: "LOW",
        expectedVersion: "riskver_breach_corr_0001",
        impactSummary: "Acknowledge opérateur sans modifier les limites.",
        payload: { breachId: "breach_corr_es_nq_watch_20260810" }
      },
      {
        actionId: "act_risk_kill_switch",
        label: "Kill switch",
        commandType: "risk.emergency.kill_switch",
        permission: "STEP_UP_REQUIRED",
        requiresConfirmation: true,
        criticality: "EMERGENCY",
        expectedVersion: "riskver_global_20260810_0940",
        impactSummary: "Emergency : bloque nouveaux ordres et demande flat/reconcile via backend. Aucun ordre broker direct depuis le front.",
        payload: { scope: "GLOBAL", dryRun: true, requiresStepUp: true }
      }
    ]
  }
};

export const executionProvidersView: ViewEnvelope<ExecutionProvidersView> = {
  meta: commonMeta,
  permissions: commonPermissions,
  data: {
    summary: {
      primaryProviderId: "provider_ninjatrader_sim101",
      standbyProviderId: "provider_pickmytrade_shadow",
      activeProviders: 1,
      degradedProviders: 1,
      disconnectedProviders: 0,
      accounts: 3,
      avgLatencyMs: 750,
      fillRatePct: 98.4,
      slippageR: 0.01,
      openIncidents: 1
    },
    providers: [
      {
        providerId: "provider_ninjatrader_sim101",
        label: "NinjaTrader Sim101",
        adapter: "NINJATRADER",
        role: "PRIMARY",
        state: "ACTIVE",
        accountIds: ["acct_sim101_main", "acct_sim101_shadow"],
        heartbeatAt: "2026-08-10T09:39:58.000Z",
        latencyMs: 750,
        fillRatePct: 98.4,
        slippageR: 0.01,
        lastReconciliationAt: "2026-08-10T09:41:02.000Z",
        sessionHealth: "OK",
        connectivity: "CONNECTED",
        browserExposure: "NONE",
        expectedVersion: "providerver_ninjatrader_sim101_20260810_0940",
        capabilities: ["TEST_PROVIDER", "RECONNECT", "RECONCILE", "PAPER_ORDER", "POSITION_SNAPSHOT"]
      },
      {
        providerId: "provider_pickmytrade_shadow",
        label: "PickMyTrade Shadow",
        adapter: "PICKMYTRADE",
        role: "STANDBY",
        state: "DEGRADED",
        accountIds: ["acct_pickmytrade_demo"],
        heartbeatAt: "2026-08-10T09:39:35.000Z",
        latencyMs: 0,
        fillRatePct: 0,
        slippageR: 0,
        lastReconciliationAt: "2026-08-10T09:31:12.000Z",
        sessionHealth: "WATCH",
        connectivity: "DEGRADED",
        browserExposure: "NONE",
        expectedVersion: "providerver_pickmytrade_shadow_20260810_0940",
        capabilities: ["SHADOW_VALIDATE", "DEMO_ORDER_DISABLED", "SWITCH_TARGET_VALIDATION_PENDING"]
      },
      {
        providerId: "provider_simulated_feed",
        label: "Internal simulation provider",
        adapter: "SIMULATED",
        role: "DEMO",
        state: "DEMO",
        accountIds: ["acct_internal_demo"],
        heartbeatAt: "2026-08-10T09:40:00.000Z",
        latencyMs: 12,
        fillRatePct: 100,
        slippageR: 0,
        lastReconciliationAt: "2026-08-10T09:40:00.000Z",
        sessionHealth: "OK",
        connectivity: "CONNECTED",
        browserExposure: "NONE",
        expectedVersion: "providerver_internal_demo_20260810_0940",
        capabilities: ["SIMULATION_ONLY", "DRY_RUN_ORDER"]
      }
    ],
    accounts: [
      {
        accountId: "acct_sim101_main",
        providerId: "provider_ninjatrader_sim101",
        label: "Sim101 main",
        mode: "PAPER",
        state: "AVAILABLE",
        netLiqUsd: 124_700,
        buyingPowerUsd: 498_800,
        openPositions: 2,
        ordersToday: 4,
        lastPositionCheckAt: "2026-08-10T09:41:02.000Z"
      },
      {
        accountId: "acct_pickmytrade_demo",
        providerId: "provider_pickmytrade_shadow",
        label: "PickMyTrade demo shadow",
        mode: "SHADOW",
        state: "RECONCILING",
        netLiqUsd: 0,
        buyingPowerUsd: 0,
        openPositions: 0,
        ordersToday: 0,
        lastPositionCheckAt: "2026-08-10T09:31:12.000Z"
      },
      {
        accountId: "acct_internal_demo",
        providerId: "provider_simulated_feed",
        label: "Internal dry-run",
        mode: "DEMO",
        state: "AVAILABLE",
        netLiqUsd: 50_000,
        buyingPowerUsd: 200_000,
        openPositions: 0,
        ordersToday: 2,
        lastPositionCheckAt: "2026-08-10T09:40:00.000Z"
      }
    ],
    adapters: [
      {
        adapterId: "adapter_ninjatrader_addon_v1",
        label: "NinjaTrader AddOn bridge",
        providerId: "provider_ninjatrader_sim101",
        version: "1.0.0",
        installed: true,
        availableStates: ["ACTIVE", "STANDBY", "DEGRADED", "DISCONNECTED", "DISABLED"],
        capabilityCount: 5,
        lastValidatedAt: "2026-08-10T09:38:45.000Z"
      },
      {
        adapterId: "adapter_pickmytrade_v1",
        label: "PickMyTrade provider adapter",
        providerId: "provider_pickmytrade_shadow",
        version: "0.1.0-due-diligence",
        installed: true,
        availableStates: [
          "NOT_CONFIGURED",
          "VALIDATION_PENDING",
          "DEMO",
          "SHADOW",
          "ACTIVE",
          "STANDBY",
          "DEGRADED",
          "DISCONNECTED",
          "DISABLED"
        ],
        capabilityCount: 3,
        lastValidatedAt: "2026-08-10T09:31:12.000Z"
      },
      {
        adapterId: "adapter_broker_api_future",
        label: "Broker API future port",
        providerId: "provider_future_broker_api",
        version: "not-installed",
        installed: false,
        availableStates: ["NOT_CONFIGURED", "DISABLED"],
        capabilityCount: 0
      }
    ],
    healthChecks: [
      { checkId: "chk_nt_heartbeat", providerId: "provider_ninjatrader_sim101", label: "Heartbeat AddOn", status: "PASS", latencyMs: 18, detail: "Dernier ping reçu depuis le VPS.", checkedAt: "2026-08-10T09:39:58.000Z" },
      { checkId: "chk_nt_session", providerId: "provider_ninjatrader_sim101", label: "Session Sim101", status: "PASS", latencyMs: 32, detail: "Compte connecté, ordres paper autorisés.", checkedAt: "2026-08-10T09:39:58.000Z" },
      { checkId: "chk_pmt_shadow", providerId: "provider_pickmytrade_shadow", label: "PickMyTrade shadow validation", status: "WATCH", latencyMs: 0, detail: "Shadow dégradé ; pas autoritaire, aucun demo order autorisé.", checkedAt: "2026-08-10T09:39:35.000Z" },
      { checkId: "chk_browser_exposure", providerId: "provider_ninjatrader_sim101", label: "Browser exposure", status: "PASS", latencyMs: 0, detail: "Projection navigateur limitée aux états opérationnels.", checkedAt: "2026-08-10T09:40:00.000Z" }
    ],
    switchWorkflow: [
      { stepId: "freeze_new_orders", label: "Freeze new orders", state: "READY", detail: "Bloque nouvelles intentions pendant la bascule.", order: 1 },
      { stepId: "position_check", label: "Position check", state: "READY", detail: "Compare positions backend et provider cible.", order: 2 },
      { stepId: "sync_target", label: "Sync target", state: "PENDING", detail: "Synchronise comptes/provider target en simulation.", order: 3 },
      { stepId: "activate_target", label: "Activer cible", state: "PENDING", detail: "Active provider cible après step-up uniquement.", order: 4 },
      { stepId: "reconcile", label: "Reconcile", state: "PENDING", detail: "Réconciliation post-switch obligatoire.", order: 5 },
      { stepId: "resume", label: "Reprendre", state: "PENDING", detail: "Reprend les ordres après preuve OK.", order: 6 }
    ],
    events: [
      { eventId: "evt_broker_netting_completed", providerId: "provider_ninjatrader_sim101", at: "2026-08-10T09:40:56.690Z", title: "Broker netting terminé", eventType: "broker.netting.completed", status: "RECEIVED", correlationId: "corr_live_reconcile_cln5_20260810", route: "/events" },
      { eventId: "evt_execution_gateway_accepted", providerId: "provider_ninjatrader_sim101", at: "2026-08-10T09:40:57.510Z", title: "Execution Gateway accepté", eventType: "execution.gateway.accepted", status: "RECEIVED", correlationId: "corr_live_reconcile_cln5_20260810", route: "/events" },
      { eventId: "evt_provider_order_ack", providerId: "provider_ninjatrader_sim101", at: "2026-08-10T09:40:58.260Z", title: "NinjaTrader ACK", eventType: "provider.order.ack", status: "RECEIVED", correlationId: "corr_live_reconcile_cln5_20260810", route: "/events" },
      { eventId: "evt_reconciliation_completed", providerId: "provider_ninjatrader_sim101", at: "2026-08-10T09:41:02.000Z", title: "Réconciliation provider", eventType: "provider.reconcile.completed", status: "RECEIVED", correlationId: "corr_live_reconcile_cln5_20260810", route: "/events" }
    ],
    incidents: [
      {
        incidentId: "inc_provider_shadow_latency",
        providerId: "provider_pickmytrade_shadow",
        severity: "MEDIUM",
        title: "PickMyTrade shadow dégradé",
        detail: "Validation shadow incomplète ; provider non autoritaire.",
        route: "/execution/incidents"
      }
    ],
    commandActions: [
      {
        actionId: "act_provider_test_nt",
        label: "Tester Ninja",
        commandType: "execution.provider.test",
        providerId: "provider_ninjatrader_sim101",
        permission: "ALLOWED",
        requiresConfirmation: false,
        criticality: "LOW",
        expectedVersion: "providerver_ninjatrader_sim101_20260810_0940",
        simulationOnly: true,
        impactSummary: "Ping provider et session paper sans ordre.",
        payload: { providerId: "provider_ninjatrader_sim101", check: "heartbeat" }
      },
      {
        actionId: "act_provider_reconnect_nt",
        label: "Reconnect Ninja",
        commandType: "execution.provider.reconnect",
        providerId: "provider_ninjatrader_sim101",
        permission: "ALLOWED",
        requiresConfirmation: true,
        criticality: "MEDIUM",
        expectedVersion: "providerver_ninjatrader_sim101_20260810_0940",
        simulationOnly: true,
        impactSummary: "Reconnecte le canal AddOn sans basculer de provider.",
        payload: { providerId: "provider_ninjatrader_sim101" }
      },
      {
        actionId: "act_provider_reconcile_nt",
        label: "Réconcilier",
        commandType: "execution.provider.reconcile",
        providerId: "provider_ninjatrader_sim101",
        permission: "ALLOWED",
        requiresConfirmation: true,
        criticality: "MEDIUM",
        expectedVersion: "providerver_ninjatrader_sim101_20260810_0940",
        simulationOnly: true,
        impactSummary: "Compare positions/orders/fills provider et backend.",
        payload: { providerId: "provider_ninjatrader_sim101", accountId: "acct_sim101_main" }
      },
      {
        actionId: "act_provider_switch_to_pmt_shadow",
        label: "Switch primary",
        commandType: "execution.provider.switch_primary",
        providerId: "provider_pickmytrade_shadow",
        permission: "STEP_UP_REQUIRED",
        requiresConfirmation: true,
        criticality: "HIGH",
        expectedVersion: "providerver_pickmytrade_shadow_20260810_0940",
        simulationOnly: true,
        impactSummary: "Simulation : freeze → position check → sync → activate target → reconcile → resume.",
        payload: { targetProviderId: "provider_pickmytrade_shadow", sourceProviderId: "provider_ninjatrader_sim101", workflowId: "provider_switch_nt_to_pmt_shadow" }
      },
      {
        actionId: "act_provider_disable_pmt",
        label: "Disable PMT",
        commandType: "execution.provider.disable",
        providerId: "provider_pickmytrade_shadow",
        permission: "STEP_UP_REQUIRED",
        requiresConfirmation: true,
        criticality: "HIGH",
        expectedVersion: "providerver_pickmytrade_shadow_20260810_0940",
        simulationOnly: true,
        impactSummary: "Désactive PickMyTrade shadow sans impacter NinjaTrader primaire.",
        payload: { providerId: "provider_pickmytrade_shadow" }
      },
      {
        actionId: "act_provider_demo_order_pmt",
        label: "Demo test order",
        commandType: "execution.provider.demo_test_order",
        providerId: "provider_pickmytrade_shadow",
        permission: "DENIED",
        requiresConfirmation: true,
        criticality: "HIGH",
        expectedVersion: "providerver_pickmytrade_shadow_20260810_0940",
        simulationOnly: true,
        impactSummary: "Refusé : demo order non explicitement autorisé pour PickMyTrade shadow.",
        payload: { providerId: "provider_pickmytrade_shadow", dryRun: true }
      }
    ]
  }
};

export const executionIncidentsView: ViewEnvelope<ExecutionIncidentsView> = {
  meta: commonMeta,
  permissions: commonPermissions,
  data: {
    summary: {
      openIncidents: 3,
      criticalIncidents: 0,
      highIncidents: 1,
      pendingReconciliations: 2,
      retryableIncidents: 2,
      avgAgeMinutes: 11,
      impactedOrders: 2,
      impactR: -0.06
    },
    filters: {
      activeSeverity: "ALL",
      activeDomain: "ALL",
      providerIds: ["provider_ninjatrader_sim101", "provider_pickmytrade_shadow"],
      statuses: ["OPEN", "ACKNOWLEDGED", "RECONCILING", "RETRYING", "RESOLVED", "DLQ"],
      searchHint: "Filtrer par incident, provider, ordre, position, status ou correlationId"
    },
    incidents: [
      {
        incidentId: "inc_live_broker_netting_cl_delta",
        title: "Delta CLN5 non critique",
        severity: "MEDIUM",
        domain: "ORDER",
        status: "RECONCILING",
        providerId: "provider_ninjatrader_sim101",
        orderId: "ord_sig_vnext_demo_mnq_0940_001",
        positionId: "pos_strinst_breakout_retest_mnq_vnext_demo",
        strategyInstanceId,
        impactR: -0.01,
        impactSummary: "Écart netting −1 CLN5 surveillé, aucun blocage global.",
        machineRecommendation: "Continuer la réconciliation provider et maintenir les ordres paper actifs.",
        correlationId: "corr_live_reconcile_cln5_20260810",
        openedAt: "2026-08-10T09:40:56.690Z",
        updatedAt: "2026-08-10T09:41:02.000Z",
        route: "/events",
        retryCount: 1,
        nextRetryAt: "2026-08-10T09:43:00.000Z",
        operatorGate: "OPTIONAL"
      },
      {
        incidentId: "inc_provider_shadow_latency",
        title: "PickMyTrade shadow dégradé",
        severity: "MEDIUM",
        domain: "PROVIDER",
        status: "ACKNOWLEDGED",
        providerId: "provider_pickmytrade_shadow",
        impactR: 0,
        impactSummary: "Provider standby en validation ; NinjaTrader reste primaire.",
        machineRecommendation: "Garder PickMyTrade en standby dégradé tant que la validation multi-état n’est pas complète.",
        correlationId: "corr_live_reconcile_cln5_20260810",
        openedAt: "2026-08-10T09:31:12.000Z",
        updatedAt: "2026-08-10T09:39:35.000Z",
        route: "/execution/providers",
        retryCount: 2,
        nextRetryAt: "2026-08-10T09:46:00.000Z",
        operatorGate: "REQUIRED"
      },
      {
        incidentId: "inc_order_partial_fill_watch",
        title: "Partial fill à surveiller",
        severity: "LOW",
        domain: "ORDER",
        status: "OPEN",
        providerId: "provider_ninjatrader_sim101",
        orderId: "ord_sig_gc_macro_0935_shadow",
        strategyInstanceId: "strinst_gc_macro_shadow_vnext_demo",
        impactR: -0.05,
        impactSummary: "Ordre shadow partiellement rempli ; pas de position LIVE autoritaire.",
        machineRecommendation: "Attendre ACK final ou annulation shadow, puis reconciler le fill tape.",
        correlationId: "corr_live_reconcile_cln5_20260810",
        openedAt: "2026-08-10T09:38:10.000Z",
        updatedAt: "2026-08-10T09:40:15.000Z",
        route: "/orders",
        retryCount: 0,
        operatorGate: "NONE"
      },
      {
        incidentId: "inc_archive_retention_blocked",
        title: "Archive legacy DLQ bloquante",
        severity: "HIGH",
        domain: "SYSTEM",
        status: "DLQ",
        impactR: 0,
        impactSummary: "Export legacy échoué après max retries ; impact audit seulement.",
        machineRecommendation: "Exporter manuellement la preuve de rétention avant purge.",
        correlationId: "corr_archive_legacy_20260810",
        openedAt: "2026-08-10T09:24:00.000Z",
        updatedAt: "2026-08-10T09:40:00.000Z",
        route: "/events",
        retryCount: 4,
        operatorGate: "REQUIRED"
      }
    ],
    selectedIncident: {
      incidentId: "inc_live_broker_netting_cl_delta",
      payloadPreview: [
        { key: "incidentId", value: "inc_live_broker_netting_cl_delta" },
        { key: "orderId", value: "ord_sig_vnext_demo_mnq_0940_001" },
        { key: "providerId", value: "provider_ninjatrader_sim101" },
        { key: "positionId", value: "pos_strinst_breakout_retest_mnq_vnext_demo" },
        { key: "correlationId", value: "corr_live_reconcile_cln5_20260810" }
      ],
      meta: [
        { label: "Source", value: "broker.netting.completed" },
        { label: "Scope", value: "PAPER · NinjaTrader Sim101" },
        { label: "Impact", value: "−0,01 R surveillé" },
        { label: "Operator gate", value: "OPTIONAL" }
      ],
      chronology: [
        { stepId: "event_netting", at: "2026-08-10T09:40:56.690Z", title: "Netting broker terminé", detail: "Delta CLN5 détecté sur chemin autoritaire.", state: "DONE", eventId: "evt_broker_netting_completed" },
        { stepId: "gateway_accepted", at: "2026-08-10T09:40:57.510Z", title: "Gateway accepté", detail: "Ordre paper transmis au provider primaire.", state: "DONE", eventId: "evt_execution_gateway_accepted" },
        { stepId: "provider_ack", at: "2026-08-10T09:40:58.260Z", title: "Provider ACK", detail: "ACK reçu, protection post-fill non bloquée.", state: "DONE", eventId: "evt_provider_order_ack" },
        { stepId: "reconcile_watch", at: "2026-08-10T09:41:02.000Z", title: "Réconciliation WATCH", detail: "Le moteur garde le delta en observation.", state: "WAITING", eventId: "evt_reconciliation_completed" }
      ],
      reconciliationResults: [
        { resultId: "rec_order_state", label: "Order state", expected: "ACCEPTED", actual: "ACCEPTED", status: "MATCH" },
        { resultId: "rec_position_qty", label: "Position quantity", expected: "2 MNQ", actual: "2 MNQ", status: "MATCH" },
        { resultId: "rec_cln5_netting", label: "CLN5 netting", expected: "0 delta", actual: "−1 delta", status: "DELTA" },
        { resultId: "rec_protection", label: "Protection", expected: "PROTECTED", actual: "PROTECTED", status: "MATCH" }
      ],
      postMortem: {
        rootCause: "Provider netting a publié un delta non bloquant après ACK ordre.",
        containment: "Incident maintenu en WATCH, aucune suspension strategy/provider.",
        permanentFix: "Ajouter un contrôle provider reconciliation ciblé sur CLN5 avant clôture session.",
        ownerRole: "EXECUTION_ENGINE",
        dueAt: "2026-08-10T10:15:00.000Z"
      }
    },
    retries: [
      { retryId: "retry_inc_live_delta_001", incidentId: "inc_live_broker_netting_cl_delta", attempt: 1, state: "FAILED", lastErrorCode: "NETTING_DELTA_STILL_PRESENT", backoffSeconds: 90 },
      { retryId: "retry_inc_live_delta_002", incidentId: "inc_live_broker_netting_cl_delta", attempt: 2, state: "SCHEDULED", nextRunAt: "2026-08-10T09:43:00.000Z", backoffSeconds: 180 },
      { retryId: "retry_provider_shadow_001", incidentId: "inc_provider_shadow_latency", attempt: 2, state: "SCHEDULED", nextRunAt: "2026-08-10T09:46:00.000Z", lastErrorCode: "SHADOW_LATENCY_WATCH", backoffSeconds: 300 },
      { retryId: "retry_archive_legacy_004", incidentId: "inc_archive_retention_blocked", attempt: 4, state: "ABANDONED", lastErrorCode: "RETENTION_PROOF_MISSING", backoffSeconds: 0 }
    ],
    commandActions: [
      {
        actionId: "act_incident_ack_delta",
        label: "Acknowledge",
        commandType: "execution.incident.acknowledge",
        incidentId: "inc_live_broker_netting_cl_delta",
        permission: "ALLOWED",
        requiresConfirmation: true,
        criticality: "LOW",
        expectedVersion: "incidentver_inc_live_broker_netting_cl_delta_20260810_0941",
        impactSummary: "Marque l’incident comme vu sans modifier ordre, provider ou stratégie.",
        payload: { incidentId: "inc_live_broker_netting_cl_delta", correlationId: "corr_live_reconcile_cln5_20260810" }
      },
      {
        actionId: "act_incident_reconcile_delta",
        label: "Reconcile",
        commandType: "execution.incident.reconcile",
        incidentId: "inc_live_broker_netting_cl_delta",
        permission: "ALLOWED",
        requiresConfirmation: true,
        criticality: "MEDIUM",
        expectedVersion: "incidentver_inc_live_broker_netting_cl_delta_20260810_0941",
        impactSummary: "Relance la réconciliation provider ciblée sur l’ordre et la position.",
        payload: { incidentId: "inc_live_broker_netting_cl_delta", providerId: "provider_ninjatrader_sim101", orderId: "ord_sig_vnext_demo_mnq_0940_001" }
      },
      {
        actionId: "act_incident_resolve_delta",
        label: "Resolve",
        commandType: "execution.incident.resolve",
        incidentId: "inc_live_broker_netting_cl_delta",
        permission: "STEP_UP_REQUIRED",
        requiresConfirmation: true,
        criticality: "HIGH",
        expectedVersion: "incidentver_inc_live_broker_netting_cl_delta_20260810_0941",
        impactSummary: "Résout le delta uniquement après preuve reconciliation MATCH.",
        payload: { incidentId: "inc_live_broker_netting_cl_delta", requireReconciliationMatch: true }
      },
      {
        actionId: "act_incident_escalate_provider_shadow",
        label: "Escalate provider",
        commandType: "execution.incident.escalate",
        incidentId: "inc_provider_shadow_latency",
        permission: "ALLOWED",
        requiresConfirmation: true,
        criticality: "MEDIUM",
        expectedVersion: "incidentver_inc_provider_shadow_latency_20260810_0939",
        impactSummary: "Escalade la validation PickMyTrade shadow sans le rendre autoritaire.",
        payload: { incidentId: "inc_provider_shadow_latency", providerId: "provider_pickmytrade_shadow" }
      },
      {
        actionId: "act_incident_suspend_pmt_shadow",
        label: "Suspend provider",
        commandType: "execution.provider.suspend",
        incidentId: "inc_provider_shadow_latency",
        permission: "STEP_UP_REQUIRED",
        requiresConfirmation: true,
        criticality: "HIGH",
        expectedVersion: "incidentver_inc_provider_shadow_latency_20260810_0939",
        impactSummary: "Suspend uniquement le provider standby ; NinjaTrader primaire reste actif.",
        payload: { incidentId: "inc_provider_shadow_latency", providerId: "provider_pickmytrade_shadow", standbyOnly: true }
      },
      {
        actionId: "act_incident_emergency_close",
        label: "Emergency close",
        commandType: "execution.incident.emergency_close",
        incidentId: "inc_live_broker_netting_cl_delta",
        permission: "DENIED",
        requiresConfirmation: true,
        criticality: "EMERGENCY",
        expectedVersion: "incidentver_inc_live_broker_netting_cl_delta_20260810_0941",
        impactSummary: "Refusé : aucune urgence broker, incident non critique.",
        payload: { incidentId: "inc_live_broker_netting_cl_delta", dryRun: true }
      }
    ]
  }
};

export const researchLabView: ViewEnvelope<ResearchLabView> = {
  meta: commonMeta,
  permissions: commonPermissions,
  data: {
    summary: {
      runningExperiments: 7,
      completedExperiments: 42,
      promotedStrategies: 3,
      rejectedStrategies: 18,
      activeResearchAgents: 6,
      computeBudgetUsedPct: 63,
      tokenBudgetUsedPct: 58
    },
    pipeline: [
      { stageId: "IDEA", label: "IDEA", state: "DONE", activeExperiments: 2, promoted: 6, rejected: 4, budgetUsedPct: 24 },
      { stageId: "BASELINE", label: "BASELINE", state: "DONE", activeExperiments: 1, promoted: 5, rejected: 5, budgetUsedPct: 38 },
      { stageId: "ITERATION", label: "ITERATION", state: "RUNNING", activeExperiments: 3, promoted: 4, rejected: 6, budgetUsedPct: 61 },
      { stageId: "ROBUSTNESS", label: "ROBUSTNESS", state: "RUNNING", activeExperiments: 2, promoted: 3, rejected: 2, budgetUsedPct: 68 },
      { stageId: "OOS", label: "OOS", state: "WAITING", activeExperiments: 1, promoted: 2, rejected: 1, budgetUsedPct: 44 },
      { stageId: "PAPER_READY", label: "PAPER READY", state: "WAITING", activeExperiments: 1, promoted: 3, rejected: 0, budgetUsedPct: 17 }
    ],
    experiments: [
      {
        experimentId: "exp_breakout_retest_mnq_oos_vnext",
        missionId: "mission_research_mnq_breakout_retest_20260810",
        runId: "run_research_mnq_oos_fold_18_24",
        title: "MNQ breakout retest — OOS rolling",
        hypothesis: "Breakout H1 + retest M15 avec filtre VIX calme",
        ownerAgent: "OOS Validator",
        stage: "OOS",
        status: "RUNNING",
        progressPct: 74,
        score: 68,
        eta: "14 min",
        currentTask: "Fold 18/24 · validation no-lookahead",
        expectedEvent: "experiment.progress.updated",
        tokenBudgetPct: 54,
        computeBudgetPct: 71
      },
      {
        experimentId: "exp_es_opening_drive_pullback",
        missionId: "mission_research_es_opening_drive_20260810",
        runId: "run_research_es_baseline_006",
        title: "ES opening drive pullback",
        hypothesis: "Pullback sur range 09:30 après imbalance mégacaps",
        ownerAgent: "Experiment Agent",
        stage: "BASELINE",
        status: "RUNNING",
        progressPct: 41,
        score: 57,
        eta: "27 min",
        currentTask: "Backtest baseline 2025-2026",
        expectedEvent: "backtest.completed",
        tokenBudgetPct: 36,
        computeBudgetPct: 49
      },
      {
        experimentId: "exp_gold_macro_impulse_gc",
        missionId: "mission_research_gc_macro_impulse_20260810",
        runId: "run_research_gc_robustness_011",
        title: "GC macro impulse after rates shock",
        hypothesis: "Continuation GC si US10Y↓ + DXY↓ après news haute",
        ownerAgent: "Robustness Auditor",
        stage: "ROBUSTNESS",
        status: "PASSED",
        progressPct: 92,
        score: 81,
        eta: "4 min",
        currentTask: "Stress slippage + gap news",
        expectedEvent: "strategy.promoted",
        tokenBudgetPct: 62,
        computeBudgetPct: 77
      },
      {
        experimentId: "exp_cl_inventory_mean_revert",
        missionId: "mission_research_cl_inventory_20260810",
        runId: "run_research_cl_iteration_009",
        title: "CL inventory mean reversion",
        hypothesis: "Mean revert CL après spike inventaires si stocks surprise extrême",
        ownerAgent: "Quantitative Validator",
        stage: "ITERATION",
        status: "WAITING",
        progressPct: 58,
        score: 49,
        eta: "en attente",
        currentTask: "Attente dataset inventaires enrichi",
        expectedEvent: "dataset.coverage.updated",
        tokenBudgetPct: 29,
        computeBudgetPct: 33
      }
    ],
    agents: [
      {
        agentId: "agent_hypothesis_01",
        taskId: "task_hypothesis_es_opening_drive_compare",
        name: "Hypothesis Agent",
        role: "Génère et classe les idées candidates",
        status: "ACTIVE",
        missionId: "mission_research_es_opening_drive_20260810",
        missionKey: "mission_research_es_opening_drive_20260810",
        task: "Comparer opening drive ES/NQ",
        model: "codex-high",
        reasoningLevel: "high",
        queueDepth: 3,
        tokenBudgetPct: 41,
        leaseActive: true,
        leaseExpiresAt: "2026-08-10T09:45:00.000Z",
        lastHeartbeatAt: "2026-08-10T09:34:00.000Z"
      },
      {
        agentId: "agent_oos_validator_01",
        taskId: "task_oos_mnq_fold_18_24",
        name: "OOS Validator",
        role: "Valide les folds hors-échantillon",
        status: "ACTIVE",
        missionId: "mission_research_mnq_breakout_retest_20260810",
        missionKey: "mission_research_mnq_breakout_retest_20260810",
        task: "OOS rolling fold 18/24",
        model: "codex-ultra",
        reasoningLevel: "ultra",
        queueDepth: 1,
        tokenBudgetPct: 64,
        leaseActive: true,
        leaseExpiresAt: "2026-08-10T09:50:00.000Z",
        lastHeartbeatAt: "2026-08-10T09:33:00.000Z"
      },
      {
        agentId: "agent_robustness_01",
        taskId: "task_robustness_gc_slippage_wait",
        name: "Robustness Auditor",
        role: "Stress tests, slippage, regimes",
        status: "WAITING",
        missionId: "mission_research_gc_macro_impulse_20260810",
        missionKey: "mission_research_gc_macro_impulse_20260810",
        task: "Attente job compute GC",
        model: "codex-high",
        reasoningLevel: "high",
        queueDepth: 2,
        tokenBudgetPct: 58,
        leaseActive: false,
        leaseExpiresAt: "unavailable",
        lastHeartbeatAt: "2026-08-10T09:20:00.000Z"
      },
      {
        agentId: "agent_data_scout_01",
        taskId: "task_data_scout_cl_inventory_backfill",
        name: "Data Scout",
        role: "Complète datasets/features point-in-time",
        status: "ACTIVE",
        missionId: "mission_research_cl_inventory_20260810",
        missionKey: "mission_research_cl_inventory_20260810",
        task: "Backfill inventaires + macro events",
        model: "codex-medium",
        reasoningLevel: "medium",
        queueDepth: 4,
        tokenBudgetPct: 23,
        leaseActive: true,
        leaseExpiresAt: "2026-08-10T09:48:00.000Z",
        lastHeartbeatAt: "2026-08-10T09:36:00.000Z"
      }
    ],
    coverage: [
      { coverageId: "cov_mnq_m5_2024_2026", label: "MNQ M5/M15", coveragePct: 98, detail: "Sessions US + Asia complètes", quality: "OK" },
      { coverageId: "cov_cross_asset_macro", label: "Cross-asset macro", coveragePct: 91, detail: "DXY, VIX, US10Y, US02Y, GC, CL", quality: "OK" },
      { coverageId: "cov_news_calendar", label: "News & calendrier", coveragePct: 76, detail: "Fallback 48h actif · ForexFactory en attente", quality: "WATCH" },
      { coverageId: "cov_execution_fills", label: "Fills broker simulés", coveragePct: 69, detail: "Ninja Sim101 + shadow provider", quality: "WATCH" }
    ],
    results: [
      {
        resultId: "result_gc_macro_impulse_promoted",
        experimentId: "exp_gold_macro_impulse_gc",
        strategyId: "str_gc_macro_impulse",
        title: "GC macro impulse",
        decision: "REVIEW",
        oosR: 11.6,
        sharpe: 1.42,
        robustnessScore: 81,
        compositeScore: 82,
        decidedAt: "2026-08-10T09:35:00.000Z"
      },
      {
        resultId: "result_nq_vwap_revert_rejected",
        experimentId: "exp_nq_vwap_revert_low_vol",
        strategyId: "str_nq_vwap_revert_low_vol",
        title: "NQ VWAP revert low-vol",
        decision: "REJECTED",
        oosR: -2.4,
        sharpe: 0.18,
        robustnessScore: 34,
        compositeScore: 17,
        decidedAt: "2026-08-10T08:58:00.000Z"
      },
      {
        resultId: "result_mnq_breakout_retest_review",
        experimentId: "exp_breakout_retest_mnq_oos_vnext",
        strategyId: "str_breakout_retest",
        title: "MNQ breakout retest",
        decision: "REVIEW",
        oosR: 7.8,
        sharpe: 0.96,
        robustnessScore: 68,
        compositeScore: 63,
        decidedAt: "2026-08-10T09:20:00.000Z"
      }
    ],
    knowledgeGraph: {
      strongestLink: "MNQ breakout retest ↔ ES opening drive · 72%",
      noveltyScore: 63,
      clusters: [
        { clusterId: "kg_breakout_open", label: "Breakout / opening drive", experiments: 9, similarityPct: 72, signal: "EDGE" },
        { clusterId: "kg_macro_metals", label: "Macro metals", experiments: 5, similarityPct: 58, signal: "NOVEL" },
        { clusterId: "kg_inventory_energy", label: "Energy inventories", experiments: 4, similarityPct: 81, signal: "DUPLICATE_RISK" }
      ]
    },
    computeQueue: [
      {
        jobId: "job_oos_mnq_fold_18_24",
        missionId: "mission_research_mnq_breakout_retest_20260810",
        label: "OOS rolling MNQ fold 18/24",
        status: "RUNNING",
        progressPct: 74,
        worker: "compute-gpu-02",
        eta: "14 min",
        costUsd: 18.42
      },
      {
        jobId: "job_robustness_gc_slippage",
        missionId: "mission_research_gc_macro_impulse_20260810",
        label: "Stress slippage GC",
        status: "RUNNING",
        progressPct: 86,
        worker: "compute-cpu-04",
        eta: "4 min",
        costUsd: 7.31
      },
      {
        jobId: "job_es_baseline_opening_drive",
        missionId: "mission_research_es_opening_drive_20260810",
        label: "Baseline ES opening drive",
        status: "QUEUED",
        progressPct: 8,
        worker: "queue-priority-a",
        eta: "27 min",
        costUsd: 3.18
      }
    ],
    datasets: [
      {
        datasetId: "ds_market_mnq_mes_m1_m15",
        label: "Market MNQ/MES M1→M15",
        lineage: "TradingView MCP → Postgres immutable candles",
        coverage: "2024-01 → 2026-08",
        pointInTime: true,
        quality: "OK"
      },
      {
        datasetId: "ds_cross_asset_pack_v4",
        label: "Cross-asset pack V4",
        lineage: "DXY/VIX/US10Y/US02Y/GC/CL snapshots",
        coverage: "cutoff-aligned",
        pointInTime: true,
        quality: "OK"
      },
      {
        datasetId: "ds_macro_news_calendar",
        label: "Macro news calendar",
        lineage: "Calendar + news fallback",
        coverage: "48h rolling",
        pointInTime: true,
        quality: "WATCH"
      }
    ],
    incidents: [
      {
        incidentId: "inc_research_news_coverage_watch",
        severity: "MEDIUM",
        title: "Couverture news à surveiller",
        detail: "Le fallback 48h couvre le desk, mais le flux ForexFactory reste à brancher.",
        openedAt: "2026-08-10T09:11:00.000Z"
      }
    ],
    activityStream: [
      { eventId: "evt_agent_task_completed_01", eventType: "TASK_COMPLETED", missionKey: "mission_research_mnq_breakout_retest_20260810", taskKey: "task_oos_fold_18", detail: "agent_oos_validator_01", at: "2026-08-10T09:33:00.000Z" },
      { eventId: "evt_agent_task_claimed_01", eventType: "TASK_CLAIMED", missionKey: "mission_research_es_opening_drive_20260810", taskKey: "task_baseline_es", detail: "agent_hypothesis_01", at: "2026-08-10T09:30:00.000Z" }
    ],
    commandActions: [
      {
        actionId: "act_research_bootstrap_demo_paper",
        label: "Amorcer backtest 1 mois",
        commandType: "research.bootstrap_demo_paper",
        permission: "ALLOWED",
        requiresConfirmation: true,
        impactSummary: "Crée dataset, stratégie seed, simulation 1 mois, candidate research et tâche agent.",
        payload: {
          symbol_code: "MNQ1!",
          instrument: "MNQ",
          timeframe: "5",
          start_utc: "2026-06-01T00:00:00.000Z",
          end_utc: "2026-07-01T00:00:00.000Z",
          dataset_key: "demo-paper.mnq.m5.2026-06-01_2026-07-01"
        }
      }
    ]
  }
};

export const researchExperimentDetailView: ViewEnvelope<ResearchExperimentDetailView> = {
  meta: commonMeta,
  permissions: commonPermissions,
  data: {
    experiment: {
      experimentId: "exp_breakout_retest_mnq_oos_vnext",
      missionId: "mission_research_mnq_breakout_retest_20260810",
      runId: "run_research_mnq_oos_fold_18_24",
      title: "MNQ breakout retest — OOS rolling",
      hypothesis: "Breakout H1 + retest M15 avec filtre VIX calme et confirmation cross-asset non divergente.",
      family: "Breakout / opening drive",
      stage: "OOS",
      status: "RUNNING",
      score: 68,
      progressPct: 74,
      currentTask: "Fold 18/24 · validation no-lookahead",
      expectedEvent: "experiment.progress.updated",
      nextAutomaticTransition: "oos.fold.completed → robustness.queue"
    },
    ownership: {
      ownerAgentId: "agent_oos_validator_01",
      ownerAgentName: "OOS Validator",
      missionId: "mission_research_mnq_breakout_retest_20260810",
      conversationId: "codex-thread-research-oos-mnq-18",
      leaseId: "lease_oos_mnq_fold_18_24",
      heartbeatAt: "2026-08-10T09:39:50.000Z",
      tokenBudgetPct: 54,
      computeBudgetPct: 71
    },
    datasets: [
      {
        datasetId: "ds_market_mnq_mes_m1_m15",
        label: "Market MNQ/MES M1→M15",
        hash: "sha256:85b6c8f1e91a6d8f",
        coverage: "2024-01 → 2026-08 · sessions Asia/US",
        quality: "OK",
        pointInTime: true
      },
      {
        datasetId: "ds_cross_asset_pack_v4",
        label: "Cross-asset pack V4",
        hash: "sha256:3ad8f6c71bb02c29",
        coverage: "DXY/VIX/US10Y/US02Y/GC/CL cutoff aligned",
        quality: "OK",
        pointInTime: true
      },
      {
        datasetId: "ds_macro_news_calendar",
        label: "Macro news calendar",
        hash: "sha256:9d0b7f2d61aebf0c",
        coverage: "48h rolling fallback",
        quality: "WATCH",
        pointInTime: true
      }
    ],
    strategySpec: {
      strategyId: "str_breakout_retest",
      strategyVersionId: "strver_breakout_retest_mnq_v4_2_0",
      specId: "spec_breakout_retest_v4_2_0",
      instrument: "MNQ",
      timeframe: "M15 decision · M1/M5 monitoring",
      entryModel: "Breakout close → pullback/retest zone → continuation trigger",
      riskModel: "0.25% net capital, stop structural, rounded-up contracts",
      invariants: [
        "Aucune anticipation, cutoff immuable",
        "Risk gate before any broker intent",
        "Cross-asset divergence can veto",
        "Entry range is upper/lower bounded"
      ]
    },
    versions: [
      {
        versionId: "strver_breakout_retest_mnq_v4_2_0",
        label: "v4.2.0 · current OOS",
        parentVersionId: "strver_breakout_retest_mnq_v4_1_0",
        createdAt: "2026-08-10T08:40:00.000Z",
        change: "Ajout filtre VIX calme + retest M5 obligatoire.",
        status: "ACTIVE"
      },
      {
        versionId: "strver_breakout_retest_mnq_v4_1_0",
        label: "v4.1.0 · baseline robuste",
        parentVersionId: "strver_breakout_retest_mnq_v4_0_0",
        createdAt: "2026-08-09T16:20:00.000Z",
        change: "Normalisation R et retest range strict.",
        status: "PARENT"
      },
      {
        versionId: "strver_breakout_retest_mnq_v4_0_0",
        label: "v4.0.0 · contrat initial",
        createdAt: "2026-08-08T14:10:00.000Z",
        change: "Première version V4 du breakout/retest déterministe.",
        status: "PARENT"
      },
      {
        versionId: "strver_breakout_retest_mnq_v4_3_candidate",
        label: "v4.3 candidate · relaxed retest",
        parentVersionId: "strver_breakout_retest_mnq_v4_2_0",
        createdAt: "2026-08-10T09:31:00.000Z",
        change: "Variante tolérante au retest partiel pour réduire le no-trade.",
        status: "CANDIDATE"
      }
    ],
    iterations: [
      {
        iterationId: "iter_mnq_baseline_001",
        at: "2026-08-10T08:42:00.000Z",
        stage: "BASELINE",
        result: "PASS",
        metricR: 18.4,
        note: "Baseline 2025–2026 profitable mais sensible aux news."
      },
      {
        iterationId: "iter_mnq_robustness_009",
        at: "2026-08-10T09:05:00.000Z",
        stage: "ROBUSTNESS",
        result: "WATCH",
        metricR: 11.2,
        note: "Slippage +0.5 tick acceptable, ouverture US volatile à surveiller."
      },
      {
        iterationId: "iter_mnq_oos_fold_18",
        at: "2026-08-10T09:32:00.000Z",
        stage: "OOS",
        result: "WATCH",
        metricR: 7.8,
        note: "Fold 18 en cours, edge présent mais trade count plus faible."
      }
    ],
    segmentedMetrics: [
      { segmentId: "seg_us_open", label: "US Open 15:30–18:00", trades: 42, pnlR: 9.6, sharpe: 1.08, maxDrawdownR: -2.1, verdict: "PASS" },
      { segmentId: "seg_asia", label: "Asia Open", trades: 31, pnlR: 3.2, sharpe: 0.54, maxDrawdownR: -1.6, verdict: "WATCH" },
      { segmentId: "seg_macro_high", label: "Macro high impact", trades: 12, pnlR: -0.8, sharpe: -0.12, maxDrawdownR: -1.3, verdict: "WATCH" },
      { segmentId: "seg_low_vol", label: "Low volatility", trades: 18, pnlR: 4.1, sharpe: 0.82, maxDrawdownR: -0.9, verdict: "PASS" }
    ],
    agentJournal: [
      {
        journalId: "journal_oos_0940_progress",
        at: "2026-08-10T09:40:00.000Z",
        level: "INFO",
        message: "Fold 18/24 progresse, aucun lookahead détecté sur les snapshots."
      },
      {
        journalId: "journal_oos_0936_tradecount",
        at: "2026-08-10T09:36:00.000Z",
        level: "WARN",
        message: "Le trade count baisse sur les trois derniers folds ; variante retest partiel proposée."
      },
      {
        journalId: "journal_oos_0928_dataset",
        at: "2026-08-10T09:28:00.000Z",
        level: "INFO",
        message: "Dataset MNQ/MES et cross-asset hashés, couverture 98%."
      }
    ],
    knowledgeCreated: [
      {
        knowledgeId: "kg_edge_mnq_us_open_retest",
        title: "Edge plus net sur US Open que Asia",
        kind: "EDGE",
        confidencePct: 74,
        route: "/research/runs/run_research_mnq_oos_fold_18_24"
      },
      {
        knowledgeId: "kg_antipattern_macro_spike",
        title: "Retest fragile autour news high impact",
        kind: "ANTI_PATTERN",
        confidencePct: 66,
        route: "/research/data"
      },
      {
        knowledgeId: "kg_regime_low_vix_breakout",
        title: "Régime VIX calme améliore continuation",
        kind: "REGIME",
        confidencePct: 71,
        route: "/strategies/str_breakout_retest"
      }
    ],
    commandActions: [
      {
        actionId: "act_exp_run_robustness_pack",
        label: "Robustness pack",
        commandType: "research.experiment.robustness.request",
        permission: "ALLOWED",
        requiresConfirmation: true,
        payload: {
          experimentId: "exp_breakout_retest_mnq_oos_vnext",
          missionId: "mission_research_mnq_breakout_retest_20260810",
          runId: "run_research_mnq_oos_fold_18_24"
        }
      },
      {
        actionId: "act_exp_create_candidate",
        label: "Candidate strategy",
        commandType: "research.experiment.candidate.create",
        permission: "STEP_UP_REQUIRED",
        requiresConfirmation: true,
        payload: {
          experimentId: "exp_breakout_retest_mnq_oos_vnext",
          strategyVersionId: "strver_breakout_retest_mnq_v4_3_candidate"
        }
      },
      {
        actionId: "act_exp_archive_variant",
        label: "Archive variant",
        commandType: "research.experiment.archive",
        permission: "ALLOWED",
        requiresConfirmation: true,
        payload: {
          experimentId: "exp_breakout_retest_mnq_oos_vnext",
          reasonCode: "SUPERSEDED_BY_CANDIDATE"
        }
      }
    ]
  }
};

export const researchRunDetailView: ViewEnvelope<ResearchRunDetailView> = {
  meta: commonMeta,
  permissions: commonPermissions,
  data: {
    run: {
      runId: "run_research_mnq_oos_fold_18_24",
      experimentId: "exp_breakout_retest_mnq_oos_vnext",
      missionId: "mission_research_mnq_breakout_retest_20260810",
      strategyVersionId: "strver_breakout_retest_mnq_v4_2_0",
      datasetId: "ds_market_mnq_mes_m1_m15",
      datasetHash: "sha256:85b6c8f1e91a6d8f",
      engineVersion: "research-engine 2.7.4",
      runtimeVersion: "deterministic-runtime 1.11.0",
      seed: 424242,
      status: "COMPLETED",
      reproducibility: "LOCKED",
      startedAt: "2026-08-10T09:12:00.000Z",
      completedAt: "2026-08-10T09:41:20.000Z"
    },
    parameters: [
      { key: "decisionTimeframe", value: "M15" },
      { key: "monitorTimeframe", value: "M1/M5" },
      { key: "riskPctNetCapital", value: 0.25 },
      { key: "entryRetestTicks", value: 18 },
      { key: "vixMax", value: 18.5 },
      { key: "allowPartialRetest", value: false }
    ],
    summary: {
      totalR: 7.8,
      maxDrawdownR: -2.1,
      trades: 103,
      winRatePct: 46.6,
      profitFactor: 1.34,
      sharpe: 0.96,
      avgMaeR: -0.42,
      avgMfeR: 0.88,
      slippageR: -0.6,
      costR: -0.42
    },
    equityCurve: [0, 1.2, 0.7, 2.4, 3.1, 2.2, 4.6, 5.1, 4.4, 6.2, 7.8],
    distribution: [
      { bucket: "< -1R", count: 7, pnlR: -8.6 },
      { bucket: "-1R..0", count: 48, pnlR: -21.2 },
      { bucket: "0..1R", count: 33, pnlR: 15.8 },
      { bucket: "> 1R", count: 15, pnlR: 21.8 }
    ],
    regimePerformance: [
      { regimeId: "reg_us_open_trend", label: "US open trend", trades: 42, pnlR: 9.6, sharpe: 1.08, verdict: "PASS" },
      { regimeId: "reg_asia_range", label: "Asia range", trades: 31, pnlR: 3.2, sharpe: 0.54, verdict: "WATCH" },
      { regimeId: "reg_macro_high", label: "Macro high impact", trades: 12, pnlR: -0.8, sharpe: -0.12, verdict: "WATCH" },
      { regimeId: "reg_low_vol", label: "Low volatility", trades: 18, pnlR: 4.1, sharpe: 0.82, verdict: "PASS" }
    ],
    hourlyPerformance: [
      { hourLabel: "09–11", trades: 18, pnlR: 1.1 },
      { hourLabel: "11–13", trades: 12, pnlR: -0.4 },
      { hourLabel: "15–16", trades: 21, pnlR: 4.8 },
      { hourLabel: "16–18", trades: 21, pnlR: 4.8 },
      { hourLabel: "18–21", trades: 31, pnlR: -2.5 }
    ],
    ambiguity: [
      {
        ambiguityId: "amb_intrabar_20260611_1545",
        barTime: "2026-06-11T15:45:00.000Z",
        reason: "Stop et target touchés dans la même bougie M1 simulée.",
        resolution: "CONSERVATIVE"
      },
      {
        ambiguityId: "amb_gap_20260618_1530",
        barTime: "2026-06-18T15:30:00.000Z",
        reason: "Gap ouverture US sur news high impact.",
        resolution: "SKIP"
      }
    ],
    benchmark: {
      baselineRunId: "run_research_mnq_baseline_v4_1_0",
      deltaR: 2.3,
      deltaDrawdownR: -0.4,
      verdict: "MIXED"
    },
    trades: [
      { tradeId: "trd_mnq_oos_001", openedAt: "2026-06-03T15:36:00.000Z", closedAt: "2026-06-03T16:08:00.000Z", symbol: "MNQ", side: "LONG", entry: 21784.5, exit: 21842.25, pnlR: 1.6, maeR: -0.2, mfeR: 1.9, regime: "US open trend" },
      { tradeId: "trd_mnq_oos_002", openedAt: "2026-06-05T10:15:00.000Z", closedAt: "2026-06-05T10:41:00.000Z", symbol: "MNQ", side: "SHORT", entry: 21912.75, exit: 21934.25, pnlR: -1.0, maeR: -1.0, mfeR: 0.3, regime: "Asia range" },
      { tradeId: "trd_mnq_oos_003", openedAt: "2026-06-11T15:48:00.000Z", closedAt: "2026-06-11T16:22:00.000Z", symbol: "MNQ", side: "LONG", entry: 22018.25, exit: 22062.5, pnlR: 1.2, maeR: -0.4, mfeR: 1.5, regime: "US open trend" },
      { tradeId: "trd_mnq_oos_004", openedAt: "2026-06-18T15:32:00.000Z", closedAt: "2026-06-18T15:46:00.000Z", symbol: "MNQ", side: "SHORT", entry: 22104.75, exit: 22128.0, pnlR: -0.8, maeR: -0.8, mfeR: 0.1, regime: "Macro high impact" },
      { tradeId: "trd_mnq_oos_005", openedAt: "2026-07-02T16:12:00.000Z", closedAt: "2026-07-02T16:55:00.000Z", symbol: "MNQ", side: "LONG", entry: 22340.25, exit: 22401.0, pnlR: 1.9, maeR: -0.1, mfeR: 2.2, regime: "Low volatility" }
    ],
    commandActions: [
      {
        actionId: "act_run_replay_identical",
        label: "Relancer identique",
        commandType: "research.run.replay_identical",
        permission: "ALLOWED",
        requiresConfirmation: true,
        payload: {
          runId: "run_research_mnq_oos_fold_18_24",
          seed: 424242,
          datasetHash: "sha256:85b6c8f1e91a6d8f"
        }
      },
      {
        actionId: "act_run_export_report",
        label: "Exporter rapport",
        commandType: "research.run.export",
        permission: "ALLOWED",
        requiresConfirmation: false,
        payload: {
          runId: "run_research_mnq_oos_fold_18_24",
          format: "json"
        }
      },
      {
        actionId: "act_run_promote_candidate",
        label: "Promote candidate",
        commandType: "research.run.promote_candidate",
        permission: "STEP_UP_REQUIRED",
        requiresConfirmation: true,
        payload: {
          runId: "run_research_mnq_oos_fold_18_24",
          strategyVersionId: "strver_breakout_retest_mnq_v4_2_0"
        }
      }
    ]
  }
};

export const researchAgentFleetView: ViewEnvelope<ResearchAgentFleetView> = {
  meta: commonMeta,
  permissions: commonPermissions,
  data: {
    summary: {
      totalAgents: 4,
      activeAgents: 3,
      waitingAgents: 1,
      lockedLeases: 3,
      queueDepth: 10,
      avgSuccessRatePct: 86
    },
    agents: [
      {
        agentId: "agent_hypothesis_01",
        taskId: "task_hypothesis_es_opening_drive_compare",
        name: "Hypothesis Agent",
        type: "HYPOTHESIS",
        role: "Génère, compare et classe les idées candidates avant simulation.",
        missionId: "mission_research_es_opening_drive_20260810",
        conversationId: "codex-thread-research-hypothesis-es",
        runtimeStatus: "ACTIVE",
        currentTask: "Comparer opening drive ES/NQ",
        waitingForEvent: "hypothesis.rank.completed",
        model: "codex-high",
        reasoningLevel: "high",
        tokenBudgetPct: 41,
        computeBudgetPct: 38,
        leaseId: "lease_hypothesis_es_opening_drive",
        lockState: "LOCKED",
        heartbeatAt: "2026-08-10T09:40:10.000Z",
        retryCount: 0,
        successRatePct: 88,
        queueDepth: 3
      },
      {
        agentId: "agent_oos_validator_01",
        taskId: "task_oos_mnq_fold_18_24",
        name: "OOS Validator",
        type: "OOS_VALIDATOR",
        role: "Valide les folds hors-échantillon et verrouille la reproductibilité.",
        missionId: "mission_research_mnq_breakout_retest_20260810",
        conversationId: "codex-thread-research-oos-mnq-18",
        runtimeStatus: "ACTIVE",
        currentTask: "OOS rolling fold 18/24",
        waitingForEvent: "oos.fold.completed",
        model: "codex-ultra",
        reasoningLevel: "ultra",
        tokenBudgetPct: 64,
        computeBudgetPct: 71,
        leaseId: "lease_oos_mnq_fold_18_24",
        lockState: "LOCKED",
        heartbeatAt: "2026-08-10T09:40:22.000Z",
        retryCount: 0,
        successRatePct: 91,
        queueDepth: 1
      },
      {
        agentId: "agent_robustness_01",
        taskId: "task_robustness_gc_slippage_wait",
        name: "Robustness Auditor",
        type: "ROBUSTNESS_AUDITOR",
        role: "Stress tests slippage, news, gaps et changements de régime.",
        missionId: "mission_research_gc_macro_impulse_20260810",
        conversationId: "codex-thread-research-robustness-gc",
        runtimeStatus: "WAITING",
        currentTask: "Attente job compute GC",
        waitingForEvent: "compute.job.completed",
        model: "codex-high",
        reasoningLevel: "high",
        tokenBudgetPct: 58,
        computeBudgetPct: 77,
        leaseId: "lease_robustness_gc_slippage",
        lockState: "FREE",
        heartbeatAt: "2026-08-10T09:38:44.000Z",
        retryCount: 1,
        successRatePct: 84,
        queueDepth: 2
      },
      {
        agentId: "agent_data_scout_01",
        taskId: "task_data_scout_cl_inventory_backfill",
        name: "Data Scout",
        type: "DATA_SCOUT",
        role: "Complète les datasets point-in-time et signale les trous de couverture.",
        missionId: "mission_research_cl_inventory_20260810",
        conversationId: "codex-thread-research-data-cl",
        runtimeStatus: "ACTIVE",
        currentTask: "Backfill inventaires + macro events",
        waitingForEvent: "dataset.coverage.updated",
        model: "codex-medium",
        reasoningLevel: "medium",
        tokenBudgetPct: 23,
        computeBudgetPct: 33,
        leaseId: "lease_data_scout_cl_inventory",
        lockState: "LOCKED",
        heartbeatAt: "2026-08-10T09:39:55.000Z",
        retryCount: 2,
        successRatePct: 81,
        queueDepth: 4
      }
    ],
    queue: [
      {
        queueItemId: "qitem_hyp_rank_es_001",
        missionId: "mission_research_es_opening_drive_20260810",
        agentId: "agent_hypothesis_01",
        priority: "HIGH",
        expectedEvent: "hypothesis.rank.completed",
        eta: "3 min",
        state: "RUNNING"
      },
      {
        queueItemId: "qitem_oos_fold_18",
        missionId: "mission_research_mnq_breakout_retest_20260810",
        agentId: "agent_oos_validator_01",
        priority: "HIGH",
        expectedEvent: "oos.fold.completed",
        eta: "8 min",
        state: "RUNNING"
      },
      {
        queueItemId: "qitem_robustness_gc_gap",
        missionId: "mission_research_gc_macro_impulse_20260810",
        agentId: "agent_robustness_01",
        priority: "NORMAL",
        expectedEvent: "compute.job.completed",
        eta: "4 min",
        state: "WAITING_EVENT"
      },
      {
        queueItemId: "qitem_data_cl_inventory",
        missionId: "mission_research_cl_inventory_20260810",
        agentId: "agent_data_scout_01",
        priority: "NORMAL",
        expectedEvent: "dataset.coverage.updated",
        eta: "11 min",
        state: "RETRY"
      },
      {
        queueItemId: "qitem_oos_cost_audit",
        missionId: "mission_research_mnq_breakout_retest_20260810",
        agentId: "agent_oos_validator_01",
        priority: "LOW",
        expectedEvent: "cost.model.audit.completed",
        eta: "19 min",
        state: "READY"
      }
    ],
    conversations: [
      {
        conversationId: "codex-thread-research-hypothesis-es",
        agentId: "agent_hypothesis_01",
        lastMessageAt: "2026-08-10T09:40:08.000Z",
        retainedContext: "Thèse ES/NQ, opening drive, mégacaps et contraintes no-lookahead",
        tokenWindowPct: 37
      },
      {
        conversationId: "codex-thread-research-oos-mnq-18",
        agentId: "agent_oos_validator_01",
        lastMessageAt: "2026-08-10T09:40:20.000Z",
        retainedContext: "Folds 01→18, paramètres M15/M1, slippage et ambiguity policy",
        tokenWindowPct: 62
      },
      {
        conversationId: "codex-thread-research-robustness-gc",
        agentId: "agent_robustness_01",
        lastMessageAt: "2026-08-10T09:38:31.000Z",
        retainedContext: "Stress GC macro impulse, US10Y/DXY et gaps news haute priorité",
        tokenWindowPct: 54
      },
      {
        conversationId: "codex-thread-research-data-cl",
        agentId: "agent_data_scout_01",
        lastMessageAt: "2026-08-10T09:39:48.000Z",
        retainedContext: "Inventaires CL, calendrier macro et trous de couverture 48h",
        tokenWindowPct: 29
      }
    ],
    incidents: [
      {
        incidentId: "inc_agent_data_scout_news_retry",
        agentId: "agent_data_scout_01",
        severity: "MEDIUM",
        title: "Dataset inventaires CL incomplet, retry contrôlé",
        retryable: true
      },
      {
        incidentId: "inc_agent_robustness_compute_wait",
        agentId: "agent_robustness_01",
        severity: "LOW",
        title: "Robustness Auditor attend la fin du job compute",
        retryable: true
      }
    ],
    commandActions: [
      {
        actionId: "act_agent_oos_wake",
        label: "Réveiller OOS Validator",
        agentId: "agent_oos_validator_01",
        commandType: "research.agent.wake",
        permission: "ALLOWED",
        requiresConfirmation: false,
        payload: {
          agentId: "agent_oos_validator_01",
          missionId: "mission_research_mnq_breakout_retest_20260810"
        }
      },
      {
        actionId: "act_agent_data_retry",
        label: "Relancer Data Scout",
        agentId: "agent_data_scout_01",
        commandType: "research.agent.retry",
        permission: "ALLOWED",
        requiresConfirmation: true,
        payload: {
          agentId: "agent_data_scout_01",
          incidentId: "inc_agent_data_scout_news_retry"
        }
      },
      {
        actionId: "act_agent_hypothesis_pause",
        label: "Pause Hypothesis Agent",
        agentId: "agent_hypothesis_01",
        commandType: "research.agent.pause",
        permission: "STEP_UP_REQUIRED",
        requiresConfirmation: true,
        payload: {
          agentId: "agent_hypothesis_01",
          reason: "operator_review"
        }
      },
      {
        actionId: "act_mission_gc_cancel",
        label: "Annuler mission GC",
        agentId: "agent_robustness_01",
        commandType: "research.mission.cancel",
        permission: "DENIED",
        requiresConfirmation: true,
        payload: {
          missionId: "mission_research_gc_macro_impulse_20260810",
          reason: "requires_research_lead_step_up"
        }
      }
    ]
  }
};

export const researchDataCatalogView: ViewEnvelope<ResearchDataCatalogView> = {
  meta: commonMeta,
  permissions: commonPermissions,
  data: {
    summary: {
      datasets: 3,
      instruments: 10,
      features: 6,
      qualityOkPct: 87,
      openGaps: 3,
      lineageEdges: 9
    },
    datasets: [
      {
        datasetId: "ds_market_mnq_mes_m1_m15",
        label: "Market MNQ/MES M1→M15",
        instruments: ["MNQ", "MES", "NQ", "ES"],
        granularity: "M1 · M5 · M15",
        period: "2024-01 → 2026-08",
        source: "TradingView MCP → Postgres immutable candles",
        provenance: "tradingview.webhook.local + backfill operator",
        quality: "OK",
        freshness: "22 s",
        pointInTime: true,
        lookaheadStatus: "PASS",
        version: "market-pack-v4.2.0",
        gaps: 0,
        timezone: "Europe/Paris",
        rolloverPolicy: "continuous contract + front-month audit"
      },
      {
        datasetId: "ds_cross_asset_pack_v4",
        label: "Cross-asset pack V4",
        instruments: ["DXY", "VIX", "US10Y", "US02Y", "GC", "CL"],
        granularity: "M15 · H4 · daily snapshot",
        period: "cutoff aligned",
        source: "Canonical snapshots → immutable pack",
        provenance: "DXY/VIX/rates/metals/energy snapshots at cutoff",
        quality: "OK",
        freshness: "1 min",
        pointInTime: true,
        lookaheadStatus: "PASS",
        version: "cross-asset-v4.0.3",
        gaps: 1,
        timezone: "UTC",
        rolloverPolicy: "snapshot by source timestamp"
      },
      {
        datasetId: "ds_macro_news_calendar",
        label: "Macro news calendar",
        instruments: ["CPI", "FOMC", "NFP", "PMI"],
        granularity: "event stream · 48h window",
        period: "rolling 48h + historical archive",
        source: "Calendar/news fallback → Postgres events",
        provenance: "calendar provider + news fallback, ForexFactory pending",
        quality: "WATCH",
        freshness: "17 min",
        pointInTime: true,
        lookaheadStatus: "WATCH",
        version: "macro-news-v1.6.0",
        gaps: 2,
        timezone: "Europe/Paris",
        rolloverPolicy: "not applicable"
      }
    ],
    instruments: [
      { symbol: "MNQ", assetClass: "FUTURES", primaryDatasetId: "ds_market_mnq_mes_m1_m15", sessionTemplate: "CME Equity Index", timezone: "America/Chicago", rollover: "quarterly", nextRollover: "2026-09-17", coveragePct: 98, quality: "OK" },
      { symbol: "MES", assetClass: "FUTURES", primaryDatasetId: "ds_market_mnq_mes_m1_m15", sessionTemplate: "CME Equity Index", timezone: "America/Chicago", rollover: "quarterly", nextRollover: "2026-09-17", coveragePct: 98, quality: "OK" },
      { symbol: "DXY", assetClass: "FX", primaryDatasetId: "ds_cross_asset_pack_v4", sessionTemplate: "FX composite", timezone: "UTC", rollover: "none", nextRollover: "—", coveragePct: 94, quality: "OK" },
      { symbol: "VIX", assetClass: "FUTURES", primaryDatasetId: "ds_cross_asset_pack_v4", sessionTemplate: "CBOE cash index", timezone: "America/New_York", rollover: "none", nextRollover: "—", coveragePct: 92, quality: "OK" },
      { symbol: "US10Y", assetClass: "RATES", primaryDatasetId: "ds_cross_asset_pack_v4", sessionTemplate: "Treasury yield", timezone: "America/New_York", rollover: "none", nextRollover: "—", coveragePct: 91, quality: "OK" },
      { symbol: "US02Y", assetClass: "RATES", primaryDatasetId: "ds_cross_asset_pack_v4", sessionTemplate: "Treasury yield", timezone: "America/New_York", rollover: "none", nextRollover: "—", coveragePct: 91, quality: "OK" },
      { symbol: "GC", assetClass: "FUTURES", primaryDatasetId: "ds_cross_asset_pack_v4", sessionTemplate: "COMEX Metals", timezone: "America/New_York", rollover: "front-month", nextRollover: "2026-08-28", coveragePct: 89, quality: "WATCH" },
      { symbol: "CL", assetClass: "FUTURES", primaryDatasetId: "ds_cross_asset_pack_v4", sessionTemplate: "NYMEX Energy", timezone: "America/New_York", rollover: "front-month", nextRollover: "2026-08-20", coveragePct: 88, quality: "WATCH" },
      { symbol: "CPI", assetClass: "MACRO", primaryDatasetId: "ds_macro_news_calendar", sessionTemplate: "US macro", timezone: "America/New_York", rollover: "event", nextRollover: "2026-08-12", coveragePct: 82, quality: "WATCH" },
      { symbol: "FOMC", assetClass: "MACRO", primaryDatasetId: "ds_macro_news_calendar", sessionTemplate: "US macro", timezone: "America/New_York", rollover: "event", nextRollover: "2026-09-16", coveragePct: 84, quality: "WATCH" }
    ],
    features: [
      {
        featureId: "feat_market_ohlc_rsi_vwap",
        label: "OHLC + RSI + VWAP",
        family: "PRICE",
        datasetId: "ds_market_mnq_mes_m1_m15",
        granularity: "M1/M5/M15",
        version: "feature-v4.2.0",
        dependsOn: ["ds_market_mnq_mes_m1_m15"],
        freshness: "22 s",
        quality: "OK",
        lookaheadStatus: "PASS",
        usedBy: "Breakout Retest · research/live parity"
      },
      {
        featureId: "feat_market_structure_retest",
        label: "Breakout/retest structure",
        family: "PRICE",
        datasetId: "ds_market_mnq_mes_m1_m15",
        granularity: "M1/M5/M15",
        version: "feature-v4.3-candidate",
        dependsOn: ["ds_market_mnq_mes_m1_m15"],
        freshness: "22 s",
        quality: "OK",
        lookaheadStatus: "PASS",
        usedBy: "Research strategy generator"
      },
      {
        featureId: "feat_cross_asset_risk_state",
        label: "DXY/VIX/rates risk state",
        family: "CROSS_ASSET",
        datasetId: "ds_cross_asset_pack_v4",
        granularity: "M15/H4",
        version: "feature-v4.0.3",
        dependsOn: ["ds_cross_asset_pack_v4"],
        freshness: "1 min",
        quality: "OK",
        lookaheadStatus: "PASS",
        usedBy: "AI Context Gate + strategy filters"
      },
      {
        featureId: "feat_macro_event_window",
        label: "Macro event proximity",
        family: "MACRO",
        datasetId: "ds_macro_news_calendar",
        granularity: "event stream",
        version: "feature-v1.6.0",
        dependsOn: ["ds_macro_news_calendar"],
        freshness: "17 min",
        quality: "WATCH",
        lookaheadStatus: "WATCH",
        usedBy: "News veto and robustness tests"
      },
      {
        featureId: "feat_quality_gap_detector",
        label: "Gap/coverage detector",
        family: "QUALITY",
        datasetId: "ds_macro_news_calendar",
        granularity: "dataset audit",
        version: "feature-v1.2.1",
        dependsOn: ["ds_market_mnq_mes_m1_m15", "ds_cross_asset_pack_v4", "ds_macro_news_calendar"],
        freshness: "2 min",
        quality: "WATCH",
        lookaheadStatus: "PASS",
        usedBy: "Operations incidents"
      },
      {
        featureId: "feat_execution_fill_replay",
        label: "Simulated fill replay",
        family: "EXECUTION",
        datasetId: "ds_market_mnq_mes_m1_m15",
        granularity: "M1 intrabar",
        version: "feature-v0.9.0",
        dependsOn: ["ds_market_mnq_mes_m1_m15"],
        freshness: "22 s",
        quality: "OK",
        lookaheadStatus: "PASS",
        usedBy: "Research run PnL determinism"
      }
    ],
    lineage: [
      { edgeId: "lin_tv_market_ingest", from: "TradingView MCP", to: "ds_market_mnq_mes_m1_m15", relation: "INGESTS", status: "OK" },
      { edgeId: "lin_market_features", from: "ds_market_mnq_mes_m1_m15", to: "feat_market_ohlc_rsi_vwap", relation: "BUILDS", status: "OK" },
      { edgeId: "lin_retest_features", from: "ds_market_mnq_mes_m1_m15", to: "feat_market_structure_retest", relation: "BUILDS", status: "OK" },
      { edgeId: "lin_cross_ingest", from: "Canonical snapshots", to: "ds_cross_asset_pack_v4", relation: "INGESTS", status: "OK" },
      { edgeId: "lin_cross_features", from: "ds_cross_asset_pack_v4", to: "feat_cross_asset_risk_state", relation: "BUILDS", status: "OK" },
      { edgeId: "lin_macro_ingest", from: "Calendar/news fallback", to: "ds_macro_news_calendar", relation: "INGESTS", status: "WATCH" },
      { edgeId: "lin_macro_features", from: "ds_macro_news_calendar", to: "feat_macro_event_window", relation: "BUILDS", status: "WATCH" },
      { edgeId: "lin_quality_audit", from: "feat_quality_gap_detector", to: "Operations incidents", relation: "FEEDS", status: "WATCH" },
      { edgeId: "lin_research_run", from: "feat_execution_fill_replay", to: "run_research_mnq_oos_fold_18_24", relation: "FEEDS", status: "OK" }
    ],
    incidents: [
      {
        incidentId: "inc_data_macro_news_watch",
        datasetId: "ds_macro_news_calendar",
        severity: "MEDIUM",
        title: "Actualités passées incomplètes, fallback 48h actif",
        status: "WATCHING",
        retryable: true
      },
      {
        incidentId: "inc_data_cross_asset_gc_gap",
        datasetId: "ds_cross_asset_pack_v4",
        severity: "LOW",
        title: "GC front-month gap mineur à auditer",
        status: "OPEN",
        retryable: true
      }
    ],
    commandActions: [
      {
        actionId: "act_data_validate_market",
        label: "Valider market pack",
        datasetId: "ds_market_mnq_mes_m1_m15",
        commandType: "research.data.validate",
        permission: "ALLOWED",
        requiresConfirmation: true,
        payload: {
          datasetId: "ds_market_mnq_mes_m1_m15",
          validation: "coverage_no_lookahead"
        }
      },
      {
        actionId: "act_data_recompute_macro",
        label: "Recompute macro features",
        datasetId: "ds_macro_news_calendar",
        commandType: "research.data.recompute",
        permission: "ALLOWED",
        requiresConfirmation: true,
        payload: {
          datasetId: "ds_macro_news_calendar",
          featureFamily: "MACRO"
        }
      },
      {
        actionId: "act_data_audit_cross_asset",
        label: "Auditer cross-asset",
        datasetId: "ds_cross_asset_pack_v4",
        commandType: "research.data.audit",
        permission: "ALLOWED",
        requiresConfirmation: false,
        payload: {
          datasetId: "ds_cross_asset_pack_v4",
          incidentId: "inc_data_cross_asset_gc_gap"
        }
      },
      {
        actionId: "act_data_invalidate_news",
        label: "Invalider news pack",
        datasetId: "ds_macro_news_calendar",
        commandType: "research.data.invalidate",
        permission: "STEP_UP_REQUIRED",
        requiresConfirmation: true,
        payload: {
          datasetId: "ds_macro_news_calendar",
          reason: "operator_quality_review"
        }
      }
    ]
  }
};

export const researchComputeSchedulerView: ViewEnvelope<ResearchComputeSchedulerView> = {
  meta: commonMeta,
  permissions: commonPermissions,
  data: {
    summary: {
      runningJobs: 3,
      queuedJobs: 2,
      waitingJobs: 1,
      dlqItems: 1,
      activeWorkers: 5,
      liveReservedPct: 35,
      researchUsedPct: 63,
      costTodayUsd: 42.91
    },
    pools: [
      { poolId: "pool_live_reserved", label: "LIVE reserved capacity", mode: "LIVE_RESERVED", status: "ACTIVE", capacityVcpu: 8, capacityMemoryGb: 24, usedPct: 41, reservedForLivePct: 100, runningJobs: 1, queuedJobs: 0 },
      { poolId: "pool_research_cpu", label: "Research CPU batch", mode: "RESEARCH", status: "ACTIVE", capacityVcpu: 24, capacityMemoryGb: 96, usedPct: 58, reservedForLivePct: 0, runningJobs: 2, queuedJobs: 2 },
      { poolId: "pool_research_gpu", label: "Research GPU burst", mode: "SHARED", status: "THROTTLED", capacityVcpu: 16, capacityMemoryGb: 64, usedPct: 74, reservedForLivePct: 35, runningJobs: 1, queuedJobs: 1 }
    ],
    workers: [
      { workerId: "compute-live-guard-01", poolId: "pool_live_reserved", kind: "CPU", status: "RUNNING", currentJobId: "job_live_capacity_guard", heartbeatAt: "2026-08-10T09:40:24.000Z", cpuPct: 32, memoryPct: 41, gpuPct: 0, costUsdHour: 0.82 },
      { workerId: "compute-gpu-02", poolId: "pool_research_gpu", kind: "GPU", status: "RUNNING", currentJobId: "job_oos_mnq_fold_18_24", heartbeatAt: "2026-08-10T09:40:18.000Z", cpuPct: 61, memoryPct: 74, gpuPct: 86, costUsdHour: 4.8 },
      { workerId: "compute-cpu-04", poolId: "pool_research_cpu", kind: "CPU", status: "RUNNING", currentJobId: "job_robustness_gc_slippage", heartbeatAt: "2026-08-10T09:40:15.000Z", cpuPct: 54, memoryPct: 48, gpuPct: 0, costUsdHour: 1.1 },
      { workerId: "queue-priority-a", poolId: "pool_research_cpu", kind: "CPU", status: "WAITING", currentJobId: "job_es_baseline_opening_drive", heartbeatAt: "2026-08-10T09:39:40.000Z", cpuPct: 8, memoryPct: 13, gpuPct: 0, costUsdHour: 0.42 },
      { workerId: "codex-compute-orchestrator", poolId: "pool_research_cpu", kind: "LLM_ORCHESTRATOR", status: "IDLE", heartbeatAt: "2026-08-10T09:40:10.000Z", cpuPct: 3, memoryPct: 9, gpuPct: 0, costUsdHour: 0.18 }
    ],
    jobs: [
      {
        jobId: "job_oos_mnq_fold_18_24",
        missionId: "mission_research_mnq_breakout_retest_20260810",
        experimentId: "exp_breakout_retest_mnq_oos_vnext",
        runId: "run_research_mnq_oos_fold_18_24",
        label: "OOS rolling MNQ fold 18/24",
        state: "RUNNING",
        priority: "HIGH",
        poolId: "pool_research_gpu",
        workerId: "compute-gpu-02",
        requestedVcpu: 6,
        requestedMemoryGb: 24,
        allocatedVcpu: 6,
        allocatedMemoryGb: 24,
        progressPct: 74,
        eta: "14 min",
        retryCount: 0,
        maxRetries: 3,
        startedAt: "2026-08-10T09:12:00.000Z",
        expectedEvent: "simulation.run.completed"
      },
      {
        jobId: "job_robustness_gc_slippage",
        missionId: "mission_research_gc_macro_impulse_20260810",
        experimentId: "exp_gold_macro_impulse_gc",
        runId: "run_research_gc_robustness_011",
        label: "Stress slippage GC",
        state: "RUNNING",
        priority: "NORMAL",
        poolId: "pool_research_cpu",
        workerId: "compute-cpu-04",
        requestedVcpu: 4,
        requestedMemoryGb: 16,
        allocatedVcpu: 4,
        allocatedMemoryGb: 16,
        progressPct: 86,
        eta: "4 min",
        retryCount: 0,
        maxRetries: 2,
        startedAt: "2026-08-10T09:21:00.000Z",
        expectedEvent: "compute.job.completed"
      },
      {
        jobId: "job_es_baseline_opening_drive",
        missionId: "mission_research_es_opening_drive_20260810",
        experimentId: "exp_es_opening_drive_pullback",
        runId: "run_research_es_baseline_006",
        label: "Baseline ES opening drive",
        state: "QUEUED",
        priority: "NORMAL",
        poolId: "pool_research_cpu",
        workerId: "queue-priority-a",
        requestedVcpu: 4,
        requestedMemoryGb: 12,
        allocatedVcpu: 0,
        allocatedMemoryGb: 0,
        progressPct: 8,
        eta: "27 min",
        retryCount: 0,
        maxRetries: 3,
        expectedEvent: "backtest.completed"
      },
      {
        jobId: "job_cl_inventory_dataset_refresh",
        missionId: "mission_research_cl_inventory_20260810",
        experimentId: "exp_cl_inventory_mean_revert",
        runId: "run_research_cl_iteration_009",
        label: "Actualiser le dataset inventaire CL",
        state: "RETRYING",
        priority: "NORMAL",
        poolId: "pool_research_cpu",
        requestedVcpu: 2,
        requestedMemoryGb: 8,
        allocatedVcpu: 0,
        allocatedMemoryGb: 0,
        progressPct: 58,
        eta: "11 min",
        retryCount: 2,
        maxRetries: 4,
        expectedEvent: "dataset.coverage.updated",
        errorCode: "DATA_PROVIDER_429"
      },
      {
        jobId: "job_live_capacity_guard",
        missionId: "mission_live_reconciliation_watch",
        label: "Guard capacité LIVE",
        state: "RUNNING",
        priority: "LIVE_PROTECTED",
        poolId: "pool_live_reserved",
        workerId: "compute-live-guard-01",
        requestedVcpu: 2,
        requestedMemoryGb: 4,
        allocatedVcpu: 2,
        allocatedMemoryGb: 4,
        progressPct: 100,
        eta: "continuous",
        retryCount: 0,
        maxRetries: 1,
        startedAt: "2026-08-10T08:00:00.000Z",
        expectedEvent: "live.capacity.available"
      }
    ],
    reservations: [
      { reservationId: "res_live_min_capacity", label: "LIVE min capacity", poolId: "pool_live_reserved", scope: "LIVE", reservedPct: 35, active: true, reason: "Le live ne doit jamais attendre les batches research." },
      { reservationId: "res_research_oos_window", label: "OOS research window", poolId: "pool_research_gpu", scope: "RESEARCH", reservedPct: 45, active: true, reason: "Fold OOS prioritaire tant que LIVE reserve reste libre." },
      { reservationId: "res_maintenance_backup", label: "Maintenance de secours", poolId: "pool_research_cpu", scope: "MAINTENANCE", reservedPct: 10, active: false, reason: "Inactive pendant session opérateur." }
    ],
    dlq: [
      {
        dlqId: "dlq_compute_cl_inventory_429",
        jobId: "job_cl_inventory_dataset_refresh",
        missionId: "mission_research_cl_inventory_20260810",
        errorCode: "DATA_PROVIDER_429",
        title: "Provider inventaires CL throttled",
        retryable: true,
        createdAt: "2026-08-10T09:28:45.000Z"
      }
    ],
    commandActions: [
      {
        actionId: "act_compute_prioritize_oos",
        label: "Prioriser OOS",
        jobId: "job_oos_mnq_fold_18_24",
        commandType: "research.compute.priority",
        permission: "ALLOWED",
        requiresConfirmation: false,
        payload: {
          jobId: "job_oos_mnq_fold_18_24",
          priority: "HIGH"
        }
      },
      {
        actionId: "act_compute_retry_cl",
        label: "Réessayer le dataset CL",
        jobId: "job_cl_inventory_dataset_refresh",
        commandType: "research.compute.retry",
        permission: "ALLOWED",
        requiresConfirmation: true,
        payload: {
          jobId: "job_cl_inventory_dataset_refresh",
          dlqId: "dlq_compute_cl_inventory_429"
        }
      },
      {
        actionId: "act_compute_reassign_es",
        label: "Réassigner ES",
        jobId: "job_es_baseline_opening_drive",
        commandType: "research.compute.reassign",
        permission: "ALLOWED",
        requiresConfirmation: true,
        payload: {
          jobId: "job_es_baseline_opening_drive",
          targetPoolId: "pool_research_cpu"
        }
      },
      {
        actionId: "act_compute_pause_research",
        label: "Pause pool research",
        poolId: "pool_research_gpu",
        commandType: "research.compute.pool.pause",
        permission: "STEP_UP_REQUIRED",
        requiresConfirmation: true,
        payload: {
          poolId: "pool_research_gpu",
          reason: "operator_capacity_review"
        }
      }
    ]
  }
};

export const strategyCenterView: ViewEnvelope<StrategyCenterView> = {
  meta: commonMeta,
  permissions: commonPermissions,
  data: {
    summary: {
      totalStrategies: 8,
      liveStrategies: 2,
      paperStrategies: 3,
      watchlistStrategies: 2,
      suspendedStrategies: 1,
      averageProfitFactor: 1.43,
      averageDrawdownR: -2.18,
      averageExpectancyR: 0.34
    },
    strategies: [
      {
        strategyId: "str_breakout_retest",
        strategyDefinitionId: "strdef_breakout_retest_mnq",
        strategyVersionId: "strver_breakout_retest_mnq_v4_2_0",
        strategyInstanceId,
        runtimeBundleId: "rtbundle_breakout_retest_mnq_v4_2_0_paper",
        name: "Breakout Retest",
        family: "Breakout",
        instruments: ["MNQ", "MES"],
        timeframe: "M15/M5",
        scientificStatus: "VALIDATED",
        versionStatus: "VALIDATED",
        runtimeStatus: "RUNNING",
        executionMode: "PAPER",
        tier: "TIER_1",
        expectancyR: 0.42,
        profitFactor: 1.61,
        winRatePct: 54,
        maxDrawdownR: -1.85,
        liveHealth: "OK",
        lifecycle: "PAPER",
        lastOosR: 14.2
      },
      {
        strategyId: "str_gc_macro_impulse",
        strategyDefinitionId: "strdef_gc_macro_impulse",
        strategyVersionId: "strver_gc_macro_impulse_v1_3_0",
        strategyInstanceId: "strinst_gc_macro_impulse_shadow_demo",
        runtimeBundleId: "rtbundle_gc_macro_impulse_v1_3_0_shadow",
        name: "GC Macro Impulse",
        family: "Macro",
        instruments: ["MGC", "GC"],
        timeframe: "M15/H1",
        scientificStatus: "CANDIDATE",
        versionStatus: "VALIDATED",
        runtimeStatus: "STARTING",
        executionMode: "SHADOW",
        tier: "TIER_2",
        expectancyR: 0.37,
        profitFactor: 1.52,
        winRatePct: 49,
        maxDrawdownR: -2.25,
        liveHealth: "WATCH",
        lifecycle: "SHADOW",
        lastOosR: 11.6
      },
      {
        strategyId: "str_mean_revert_nq",
        strategyDefinitionId: "strdef_mean_revert_nq",
        strategyVersionId: "strver_mean_revert_nq_v2_1_1",
        strategyInstanceId: "strinst_mean_revert_nq_vnext_demo",
        runtimeBundleId: "rtbundle_mean_revert_nq_v2_1_1_live",
        name: "MeanRevert NQ",
        family: "Mean Reversion",
        instruments: ["NQ", "MNQ"],
        timeframe: "M5",
        scientificStatus: "VALIDATED",
        versionStatus: "VALIDATED",
        runtimeStatus: "RUNNING",
        executionMode: "LIVE",
        tier: "TIER_1",
        expectancyR: 0.48,
        profitFactor: 1.72,
        winRatePct: 58,
        maxDrawdownR: -1.41,
        liveHealth: "OK",
        lifecycle: "LIVE",
        lastOosR: 17.8
      },
      {
        strategyId: "str_cl_inventory_revert",
        strategyDefinitionId: "strdef_cl_inventory_revert",
        strategyVersionId: "strver_cl_inventory_revert_v0_8_0",
        strategyInstanceId: "strinst_trendrunner_cl_vnext_demo",
        runtimeBundleId: "rtbundle_cl_inventory_revert_v0_8_0_research",
        name: "CL Inventory Revert",
        family: "Mean Reversion",
        instruments: ["MCL", "CL"],
        timeframe: "M15",
        scientificStatus: "WATCHLIST",
        versionStatus: "DRAFT",
        runtimeStatus: "PAUSED",
        executionMode: "SHADOW",
        tier: "WATCH",
        expectancyR: 0.12,
        profitFactor: 1.08,
        winRatePct: 46,
        maxDrawdownR: -3.11,
        liveHealth: "WATCH",
        lifecycle: "RESEARCH",
        lastOosR: 2.1
      }
    ],
    lifecycleDistribution: [
      { label: "LIVE", count: 2, pct: 25 },
      { label: "PAPER", count: 3, pct: 37 },
      { label: "SHADOW", count: 1, pct: 13 },
      { label: "WATCHLIST", count: 2, pct: 25 }
    ],
    performanceByFamily: [
      { family: "Breakout", strategies: 2, averageProfitFactor: 1.48, expectancyR: 0.34, drawdownR: -2.1 },
      { family: "Mean Reversion", strategies: 3, averageProfitFactor: 1.33, expectancyR: 0.27, drawdownR: -2.7 },
      { family: "Macro", strategies: 2, averageProfitFactor: 1.52, expectancyR: 0.37, drawdownR: -2.25 },
      { family: "Momentum", strategies: 1, averageProfitFactor: 1.18, expectancyR: 0.18, drawdownR: -2.9 }
    ],
    topStrategies: [
      { strategyId: "str_mean_revert_nq", name: "MeanRevert NQ", score: 88, oosR: 17.8, liveParityPct: 91 },
      { strategyId: "str_breakout_retest", name: "Breakout Retest", score: 84, oosR: 14.2, liveParityPct: 87 },
      { strategyId: "str_gc_macro_impulse", name: "GC Macro Impulse", score: 76, oosR: 11.6, liveParityPct: 69 }
    ],
    recentEvents: [
      {
        eventId: "evt_strategy_gc_review",
        at: "2026-08-10T09:35:00.000Z",
        title: "GC Macro Impulse prêt pour revue",
        detail: "OOS +11,6 R · robustness 81",
        tone: "WATCH"
      },
      {
        eventId: "evt_strategy_mnq_parity",
        at: "2026-08-10T09:22:00.000Z",
        title: "Parité replay/live vérifiée",
        detail: "Breakout Retest · écart 3,2%",
        tone: "INFO"
      },
      {
        eventId: "evt_strategy_nq_live_ok",
        at: "2026-08-10T08:51:00.000Z",
        title: "MeanRevert NQ runtime nominal",
        detail: "2 instances live synchronisées",
        tone: "INFO"
      }
    ],
    selectedInspector: {
      strategyId: "str_breakout_retest",
      strategyDefinitionId: "strdef_breakout_retest_mnq",
      strategyVersionId: "strver_breakout_retest_mnq_v4_2_0",
      strategyInstanceId,
      runtimeBundleId: "rtbundle_breakout_retest_mnq_v4_2_0_paper",
      thesis: "Exploite les ruptures de structure MNQ confirmées par retest, avec filtre cross-asset et validation no-lookahead.",
      rulesSummary: [
        "Breakout confirmé sur clôture M15",
        "Retest M5 dans la zone validée",
        "Invalidation si réintégration sous niveau cassé",
        "Risque initial normalisé par capital net"
      ],
      meta: {
        instruments: ["MNQ"],
        timeframe: "M5",
        sessionScope: ["ny_open"],
        owner: "desk-research",
        publishedAt: "2026-07-18T09:00:00.000Z",
        compiledArtifactHash: "sha256:mock_breakout_retest_v4_2_0",
        executionMode: "PAPER",
        accountScope: "paper-default"
      },
      spec: {
        entryModel: "breakout_retest",
        stopModel: "structure_invalidation",
        targetModel: "measured_move",
        invalidationModel: "close_below_retest_zone",
        riskModel: "fixed_fractional",
        rules: [],
        levels: []
      },
      gates: [
        { label: "G0 · Données versionnées", state: "PASS", detail: "dataset_mnq_m5_2026" },
        { label: "G1 · Preuves de validation", state: "PASS", detail: "" },
        { label: "G2 · Robustesse", state: "PASS", detail: "" },
        { label: "G3 · Hors échantillon", state: "WATCH", detail: "OOS +11,6 R" },
        { label: "G4 · Cohérence portefeuille", state: "WATCH", detail: "Corrélation en revue" },
        { label: "G5 · Matrice de promotion", state: "PENDING", detail: "" },
        { label: "G6 · Approbation opérateur", state: "PENDING", detail: "" },
        { label: "G7 · Autorisation live", state: "FAIL", detail: "LIVE_AUTHORIZATION_EXPLICITLY_DISABLED_IN_SEMI_MANUAL_PREPROD" }
      ],
      lineage: [
        { nodeType: "HYPOTHESIS", id: "hyp_breakout_retest_mnq", at: "2026-06-01T09:00:00.000Z" },
        { nodeType: "EXPERIMENT", id: "exp_breakout_retest_mnq", at: "2026-06-02T09:00:00.000Z" },
        { nodeType: "CANDIDATE", id: "cand_breakout_retest_mnq", at: "2026-06-20T09:00:00.000Z" },
        { nodeType: "STRATEGY_VERSION", id: "strver_breakout_retest_mnq_v4_2_0", at: "2026-07-18T09:00:00.000Z" },
        { nodeType: "INSTANCE", id: strategyInstanceId, at: "2026-08-01T09:00:00.000Z" }
      ],
      runtimeInstances: [
        { strategyInstanceId, instruments: ["MNQ"], mode: "PAPER", runtimeStatus: "RUNNING", health: "OK", lastHeartbeatAt: "2026-08-10T09:30:00.000Z", signalsToday: 3 }
      ],
      performance: {
        availability: "AVAILABLE",
        expectancyR: 0.42,
        profitFactor: 1.8,
        winRatePct: 54,
        maxDrawdownR: 6.1,
        oosR: 11.6,
        series: [
          { sequence: 1, at: "2026-08-01", cumulativeR: 2, drawdownR: 0 },
          { sequence: 2, at: "2026-08-04", cumulativeR: 5.4, drawdownR: 0 },
          { sequence: 3, at: "2026-08-07", cumulativeR: 3.9, drawdownR: -1.5 }
        ]
      },
      riskAllocationPct: 18,
      currentCommandEligibility: "CAN_REQUEST_SHADOW"
    }
  }
};

export const strategyDetailView: ViewEnvelope<StrategyDetailView> = {
  meta: commonMeta,
  permissions: commonPermissions,
  data: {
    summary: {
      strategyScore: 84,
      activeVersions: 2,
      runningInstances: 1,
      riskAllocationPct: 18,
      liveParityPct: 87,
      openSignals: 1,
      trades30d: 42,
      netR30d: 14.2
    },
    identity: {
      strategyId: "str_breakout_retest",
      strategyDefinitionId: "strdef_breakout_retest_mnq",
      strategyVersionId: "strver_breakout_retest_mnq_v4_2_0",
      strategyInstanceId,
      runtimeBundleId: "rtbundle_breakout_retest_mnq_v4_2_0_paper",
      name: "Breakout Retest",
      family: "Breakout",
      thesis: "Exploite les ruptures de structure MNQ confirmées par retest M5, avec filtres cross-asset et invalidation déterministe.",
      scientificStatus: "VALIDATED",
      versionStatus: "VALIDATED",
      runtimeStatus: "RUNNING",
      executionMode: "PAPER",
      tier: "TIER_1",
      ownerAgent: "Strategy Builder"
    },
    definition: {
      strategySpecId: "spec_breakout_retest_mnq_v4_2_0",
      dslVersion: "strategy-dsl-v1",
      sourceExperimentId: "exp_breakout_retest_mnq_oos_vnext",
      sourceRunId: "run_research_mnq_oos_fold_18_24",
      instruments: ["MNQ", "MES"],
      timeframes: ["M15", "M5", "M1"],
      sessions: ["asia_open", "ny_open"],
      tags: ["breakout", "retest", "cross_asset_filter", "net_capital_risk"]
    },
    strategySpec: {
      entryModel: "BREAKOUT_CLOSE_THEN_RETEST",
      stopModel: "STRUCTURE_INVALIDATION_BELOW_BROKEN_LEVEL",
      targetModel: "PARTIAL_AT_1R_THEN_TRAIL_TO_STRUCTURE",
      invalidationModel: "REINTEGRATION_OR_NO_RETEST_BEFORE_EXPIRY",
      riskModel: "0.25% net capital rounded up to whole micro futures contracts",
      rules: [
        {
          ruleId: "rule_breakout_close_m15",
          label: "Cassure M15 clôturée",
          type: "ENTRY",
          expression: "close_m15 > structure_high + min_breakout_ticks",
          state: "ACTIVE",
          weightPct: 28
        },
        {
          ruleId: "rule_retest_m5",
          label: "Retest M5 dans la zone",
          type: "ENTRY",
          expression: "low_m5 <= entry_zone_upper && close_m5 >= entry_zone_lower",
          state: "ACTIVE",
          weightPct: 24
        },
        {
          ruleId: "rule_cross_asset_filter",
          label: "Filtre cross-asset non hostile",
          type: "FILTER",
          expression: "vix_regime != stress && dxy_impulse != hostile",
          state: "WATCH",
          weightPct: 16
        },
        {
          ruleId: "rule_risk_net_capital",
          label: "Risque net capital OK",
          type: "RISK",
          expression: "risk_pct <= 0.25 && correlation_budget_pass",
          state: "ACTIVE",
          weightPct: 20
        },
        {
          ruleId: "rule_invalidation_reintegration",
          label: "Invalidation réintégration",
          type: "INVALIDATION",
          expression: "close_m5 < broken_level",
          state: "ACTIVE",
          weightPct: 12
        }
      ],
      levels: [
        { levelId: "lvl_entry_zone_low", label: "Entry lower", lower: 19102.25, upper: 19102.25, role: "ENTRY_ZONE" },
        { levelId: "lvl_entry_zone_high", label: "Entry upper", lower: 19112.75, upper: 19112.75, role: "ENTRY_ZONE" },
        { levelId: "lvl_stop_structure", label: "Stop structure", lower: 19082.5, upper: 19082.5, role: "STOP" },
        { levelId: "lvl_target_one_r", label: "Target 1R", lower: 19142.75, upper: 19142.75, role: "TARGET" },
        { levelId: "lvl_invalidation_reentry", label: "Invalidation close", lower: 19096, upper: 19096, role: "INVALIDATION" }
      ]
    },
    constraints: [
      { constraintId: "constraint_risk_trade", label: "Max risk/trade", scope: "RISK", status: "PASS", value: "0.25% net capital" },
      { constraintId: "constraint_correlation", label: "Correlation MNQ/MES", scope: "CORRELATION", status: "WATCH", value: "81% used" },
      { constraintId: "constraint_session", label: "Session autorisée", scope: "SESSION", status: "PASS", value: "Asia + NY continuous day" },
      { constraintId: "constraint_data", label: "Point-in-time data", scope: "DATA", status: "PASS", value: "No lookahead locked" },
      { constraintId: "constraint_execution", label: "Provider mode", scope: "EXECUTION", status: "WATCH", value: "Ninja Sim101 paper" }
    ],
    regimes: [
      { regimeId: "regime_trend_day", label: "Trend day", status: "FAVOURABLE", expectancyR: 0.54, trades: 18, note: "Ruptures suivies de pullback propre." },
      { regimeId: "regime_range_compression", label: "Range compression", status: "NEUTRAL", expectancyR: 0.12, trades: 9, note: "Attendre expansion confirmée." },
      { regimeId: "regime_macro_stress", label: "Macro stress", status: "AVOID", expectancyR: -0.22, trades: 4, note: "VIX/DXY hostiles, faux breakouts fréquents." }
    ],
    versions: [
      {
        strategyVersionId: "strver_breakout_retest_mnq_v4_2_0",
        label: "v4.2.0 validated",
        status: "VALIDATED",
        createdAt: "2026-08-09T16:10:00.000Z",
        sourceRunId: "run_research_mnq_oos_fold_18_24",
        expectancyR: 0.42,
        maxDrawdownR: -1.85,
        changeSummary: "Bornes d’entrée séparées, retest déterministe, risk net capital."
      },
      {
        strategyVersionId: "strver_breakout_retest_mnq_v4_1_0",
        label: "v4.1.0 baseline",
        status: "DEPRECATED",
        createdAt: "2026-08-08T12:15:00.000Z",
        sourceRunId: "run_research_mnq_baseline_v4_1_0",
        expectancyR: 0.31,
        maxDrawdownR: -2.4,
        changeSummary: "Zone d’entrée agrégée, moins robuste en replay continu."
      },
      {
        strategyVersionId: "strver_breakout_retest_mnq_v4_3_0_candidate",
        label: "v4.3.0 candidate",
        status: "DRAFT",
        createdAt: "2026-08-10T08:20:00.000Z",
        sourceRunId: "run_research_mnq_candidate_m5_latency",
        expectancyR: 0.45,
        maxDrawdownR: -2.05,
        changeSummary: "Test M5 plus réactif, pas encore promu."
      }
    ],
    instances: [
      {
        strategyInstanceId,
        strategyVersionId: "strver_breakout_retest_mnq_v4_2_0",
        runtimeBundleId: "rtbundle_breakout_retest_mnq_v4_2_0_paper",
        mode: "PAPER",
        runtimeStatus: "RUNNING",
        account: "Sim101",
        riskAllocationPct: 18,
        lastHeartbeatAt: "2026-08-10T09:39:30.000Z"
      },
      {
        strategyInstanceId: "strinst_breakout_retest_mnq_shadow_candidate",
        strategyVersionId: "strver_breakout_retest_mnq_v4_3_0_candidate",
        runtimeBundleId: "rtbundle_breakout_retest_mnq_v4_3_0_shadow",
        mode: "SHADOW",
        runtimeStatus: "STARTING",
        account: "shadow-research",
        riskAllocationPct: 0,
        lastHeartbeatAt: "2026-08-10T09:36:00.000Z"
      }
    ],
    performance: [
      { scope: "BACKTEST", trades: 214, netR: 38.4, expectancyR: 0.42, profitFactor: 1.61, winRatePct: 54, maxDrawdownR: -1.85, parityPct: 100 },
      { scope: "PAPER", trades: 42, netR: 14.2, expectancyR: 0.34, profitFactor: 1.48, winRatePct: 52, maxDrawdownR: -2.1, parityPct: 87 },
      { scope: "LIVE", trades: 0, netR: 0, expectancyR: 0, profitFactor: 0, winRatePct: 0, maxDrawdownR: 0, parityPct: 0 }
    ],
    signals: [
      {
        signalId,
        strategyInstanceId,
        symbol: "MNQ",
        direction: "LONG",
        state: "ARBITRATED",
        confidence: 78,
        createdAt: "2026-08-10T09:40:00.000Z",
        ruleHits: ["rule_breakout_close_m15", "rule_retest_m5", "rule_risk_net_capital"]
      },
      {
        signalId: "sig_breakout_retest_mnq_0915_expired",
        strategyInstanceId,
        symbol: "MNQ",
        direction: "SHORT",
        state: "EXPIRED",
        confidence: 61,
        createdAt: "2026-08-10T09:15:00.000Z",
        ruleHits: ["rule_breakout_close_m15", "rule_invalidation_reintegration"]
      }
    ],
    trades: [
      { tradeId: "trade_mnq_breakout_20260809_01", signalId: "sig_mnq_breakout_20260809_01", symbol: "MNQ", side: "LONG", openedAt: "2026-08-09T15:45:00.000Z", closedAt: "2026-08-09T16:30:00.000Z", pnlR: 1.4, exitReason: "target_1r_then_trail" },
      { tradeId: "trade_mnq_breakout_20260808_03", signalId: "sig_mnq_breakout_20260808_03", symbol: "MNQ", side: "SHORT", openedAt: "2026-08-08T17:15:00.000Z", closedAt: "2026-08-08T17:45:00.000Z", pnlR: -0.7, exitReason: "structure_reintegration" },
      { tradeId: "trade_mes_confirm_20260807_02", signalId: "sig_mes_confirm_20260807_02", symbol: "MES", side: "LONG", openedAt: "2026-08-07T10:30:00.000Z", closedAt: "2026-08-07T11:15:00.000Z", pnlR: 2.1, exitReason: "mfe_trailing_stop" }
    ],
    incidents: [
      {
        incidentId: "inc_strategy_breakout_correlation_watch",
        severity: "MEDIUM",
        status: "ACKED",
        title: "Corrélation MNQ/MES proche limite",
        detail: "Le gate global risk demande réduction automatique si un autre signal index est accepté."
      }
    ],
    correlations: [
      { target: "strinst_mean_revert_nq_vnext_demo", correlationPct: 62, exposureOverlapPct: 34, status: "WATCH" },
      { target: "strinst_gc_macro_impulse_shadow_demo", correlationPct: 18, exposureOverlapPct: 7, status: "CLEAR" },
      { target: "portfolio_index_bucket", correlationPct: 81, exposureOverlapPct: 28, status: "WATCH" }
    ],
    riskAllocation: {
      budgetPct: 18,
      usedPct: 37,
      maxConcurrentSignals: 2,
      netCapitalPct: 0.25,
      reason: "TIER_1 paper, live gate fermé tant que la parité live/replay reste sous 90%."
    },
    commandActions: [
      {
        actionId: "act_strategy_create_version_breakout",
        label: "Créer version candidate",
        commandType: "strategy.version.create_candidate",
        permission: "ALLOWED",
        requiresConfirmation: true,
        payload: {
          strategyId: "str_breakout_retest",
          strategyDefinitionId: "strdef_breakout_retest_mnq",
          sourceRunId: "run_research_mnq_oos_fold_18_24"
        }
      },
      {
        actionId: "act_strategy_request_shadow_breakout",
        label: "Demander shadow test",
        commandType: "strategy.instance.request_shadow_test",
        permission: "ALLOWED",
        requiresConfirmation: true,
        payload: {
          strategyId: "str_breakout_retest",
          strategyVersionId: "strver_breakout_retest_mnq_v4_2_0",
          strategyInstanceId,
          runtimeBundleId: "rtbundle_breakout_retest_mnq_v4_2_0_paper"
        }
      },
      {
        actionId: "act_strategy_promote_paper_breakout",
        label: "Promouvoir Paper",
        commandType: "strategy.instance.promote_paper",
        permission: "STEP_UP_REQUIRED",
        requiresConfirmation: true,
        payload: {
          strategyInstanceId,
          requestedMode: "PAPER"
        }
      },
      {
        actionId: "act_strategy_request_live_breakout",
        label: "Demander LIVE",
        commandType: "strategy.instance.request_live",
        permission: "DENIED",
        requiresConfirmation: true,
        payload: {
          strategyInstanceId,
          requestedMode: "LIVE",
          blockedBy: "BACKEND_GATES_PARITY_UNDER_90"
        }
      },
      {
        actionId: "act_strategy_pause_breakout",
        label: "Pause instance",
        commandType: "strategy.instance.pause",
        permission: "ALLOWED",
        requiresConfirmation: true,
        payload: {
          strategyInstanceId,
          reasonCode: "OPERATOR_PAUSE"
        }
      },
      {
        actionId: "act_strategy_reduce_risk_breakout",
        label: "Réduire allocation",
        commandType: "strategy.risk.reduce_allocation",
        permission: "ALLOWED",
        requiresConfirmation: true,
        payload: {
          strategyInstanceId,
          targetRiskAllocationPct: 12
        }
      }
    ]
  }
};

export const strategyCompareView: ViewEnvelope<StrategyCompareView> = {
  meta: commonMeta,
  permissions: commonPermissions,
  data: {
    summary: {
      strategyId: "str_breakout_retest",
      baseVersionId: "strver_breakout_retest_mnq_v4_1_0",
      candidateVersionId: "strver_breakout_retest_mnq_v4_2_0",
      verdict: "PROMOTE",
      netImprovementR: 7.3,
      expectancyDeltaR: 0.11,
      profitFactorDelta: 0.13,
      drawdownDeltaR: 0.55,
      liveParityDeltaPct: 8
    },
    strategy: {
      strategyId: "str_breakout_retest",
      name: "Breakout Retest",
      family: "Breakout",
      strategyDefinitionId: "strdef_breakout_retest_mnq"
    },
    versions: [
      {
        role: "BASE",
        strategyVersionId: "strver_breakout_retest_mnq_v4_1_0",
        runtimeBundleId: "rtbundle_breakout_retest_mnq_v4_1_0_replay",
        label: "v4.1.0 baseline",
        status: "DEPRECATED",
        sourceRunId: "run_research_mnq_baseline_v4_1_0",
        createdAt: "2026-08-08T12:15:00.000Z"
      },
      {
        role: "CANDIDATE",
        strategyVersionId: "strver_breakout_retest_mnq_v4_2_0",
        runtimeBundleId: "rtbundle_breakout_retest_mnq_v4_2_0_paper",
        label: "v4.2.0 validated",
        status: "VALIDATED",
        sourceRunId: "run_research_mnq_oos_fold_18_24",
        createdAt: "2026-08-09T16:10:00.000Z"
      }
    ],
    specDiffs: [
      { diffId: "diff_entry_bounds", section: "ENTRY", field: "entry_zone", before: "single range string", after: "lower/upper numeric bounds", impact: "POSITIVE" },
      { diffId: "diff_retest_logic", section: "ENTRY", field: "retest", before: "analyst inferred", after: "deterministic M5 condition enum", impact: "POSITIVE" },
      { diffId: "diff_risk_model", section: "RISK", field: "lot sizing", before: "manual fallback", after: "0.25% net capital rounded up", impact: "POSITIVE" },
      { diffId: "diff_filter_cross_asset", section: "FILTER", field: "cross_asset", before: "advisory text", after: "VIX/DXY hostile-state watch gate", impact: "NEUTRAL" },
      { diffId: "diff_invalidation", section: "INVALIDATION", field: "expiry", before: "soft expiry", after: "re-entry or no retest before expiry", impact: "POSITIVE" }
    ],
    parameterDiffs: [
      { param: "min_breakout_ticks", before: 8, after: 10, changeType: "MODIFIED" },
      { param: "entry_zone_format", before: "range_text", after: "numeric_bounds", changeType: "MODIFIED" },
      { param: "m1_followup_guard", before: false, after: true, changeType: "ADDED" },
      { param: "manual_lot_override", before: true, after: false, changeType: "REMOVED" }
    ],
    metricComparison: [
      { metric: "EXPECTANCY_R", base: 0.31, candidate: 0.42, delta: 0.11, verdict: "BETTER" },
      { metric: "PROFIT_FACTOR", base: 1.48, candidate: 1.61, delta: 0.13, verdict: "BETTER" },
      { metric: "MAX_DD_R", base: -2.4, candidate: -1.85, delta: 0.55, verdict: "BETTER" },
      { metric: "WIN_RATE_PCT", base: 51, candidate: 54, delta: 3, verdict: "BETTER" },
      { metric: "FREQUENCY", base: 49, candidate: 42, delta: -7, verdict: "WORSE" }
    ],
    regimeComparison: [
      { regimeId: "regime_trend_day", label: "Trend day", baseR: 9.8, candidateR: 13.6, deltaR: 3.8, verdict: "BETTER" },
      { regimeId: "regime_range_compression", label: "Range compression", baseR: 1.9, candidateR: 1.1, deltaR: -0.8, verdict: "WORSE" },
      { regimeId: "regime_macro_stress", label: "Macro stress", baseR: -2.8, candidateR: -0.9, deltaR: 1.9, verdict: "BETTER" }
    ],
    divergentTrades: [
      { tradeId: "div_trade_20260611_1015", at: "2026-06-11T10:15:00.000Z", symbol: "MNQ", baseDecision: "SHORT accepted", candidateDecision: "SHORT filtered by retest guard", deltaR: 1.0, reason: "false retest removed" },
      { tradeId: "div_trade_20260612_1530", at: "2026-06-12T15:30:00.000Z", symbol: "MNQ", baseDecision: "NO TRADE", candidateDecision: "LONG accepted", deltaR: 1.7, reason: "numeric entry bounds matched" },
      { tradeId: "div_trade_20260618_1745", at: "2026-06-18T17:45:00.000Z", symbol: "MES", baseDecision: "LONG accepted", candidateDecision: "LONG reduced risk", deltaR: -0.4, reason: "correlation budget watch" }
    ],
    costs: [
      { scope: "BACKTEST", baseCostR: -1.6, candidateCostR: -1.35, slippageDeltaR: 0.12, verdict: "BETTER" },
      { scope: "PAPER", baseCostR: -0.55, candidateCostR: -0.49, slippageDeltaR: 0.04, verdict: "BETTER" },
      { scope: "LIVE", baseCostR: 0, candidateCostR: 0, slippageDeltaR: 0, verdict: "FLAT" }
    ],
    parity: [
      { scope: "BACKTEST_VS_PAPER", basePct: 79, candidatePct: 87, deltaPct: 8, status: "WATCH" },
      { scope: "BACKTEST_VS_LIVE", basePct: 0, candidatePct: 0, deltaPct: 0, status: "BLOCK" }
    ],
    deepLinks: [
      { label: "Run baseline v4.1.0", route: "/research/runs/run_research_mnq_baseline_v4_1_0", kind: "RUN" },
      { label: "Run candidat v4.2.0", route: "/research/runs/run_research_mnq_oos_fold_18_24", kind: "RUN" },
      { label: "Fiche stratégie", route: "/strategies/str_breakout_retest", kind: "STRATEGY" },
      { label: "Expérience source", route: "/research/experiments/exp_breakout_retest_mnq_oos_vnext", kind: "EXPERIMENT" }
    ],
    commandActions: [
      {
        actionId: "act_compare_create_candidate_v430",
        label: "Créer candidate depuis diff",
        commandType: "strategy.version.create_candidate_from_compare",
        permission: "ALLOWED",
        requiresConfirmation: true,
        payload: {
          strategyId: "str_breakout_retest",
          baseVersionId: "strver_breakout_retest_mnq_v4_1_0",
          candidateVersionId: "strver_breakout_retest_mnq_v4_2_0"
        }
      },
      {
        actionId: "act_compare_shadow_v420",
        label: "Lancer shadow test",
        commandType: "strategy.instance.request_shadow_test",
        permission: "ALLOWED",
        requiresConfirmation: true,
        payload: {
          strategyId: "str_breakout_retest",
          strategyVersionId: "strver_breakout_retest_mnq_v4_2_0",
          runtimeBundleId: "rtbundle_breakout_retest_mnq_v4_2_0_paper"
        }
      },
      {
        actionId: "act_compare_rollback_v410",
        label: "Rollback v4.1.0",
        commandType: "strategy.version.rollback",
        permission: "STEP_UP_REQUIRED",
        requiresConfirmation: true,
        payload: {
          strategyId: "str_breakout_retest",
          rollbackVersionId: "strver_breakout_retest_mnq_v4_1_0"
        }
      },
      {
        actionId: "act_compare_export_diff",
        label: "Exporter diff",
        commandType: "strategy.compare.export_diff",
        permission: "ALLOWED",
        requiresConfirmation: true,
        payload: {
          strategyId: "str_breakout_retest",
          format: "json"
        }
      }
    ]
  }
};

export const jarvisWorkspaceView: ViewEnvelope<JarvisWorkspaceView> = {
  meta: commonMeta,
  permissions: commonPermissions,
  data: {
    summary: {
      morningBriefStatus: "READY",
      openSuggestions: 3,
      pendingActions: 1,
      activeAgents: 4,
      voiceStatus: "DEGRADED",
      freshnessSeconds: 18
    },
    missions: [
      {
        missionId: "mission_vnext_provider_shadow",
        title: "Comparer NinjaTrader et PickMyTrade en shadow",
        ownerAgent: "Research Reviewer",
        state: "RUNNING"
      },
      {
        missionId: "mission_research_mnq_breakout_retest_20260810",
        title: "Valider MNQ Breakout Retest OOS",
        ownerAgent: "OOS Validator",
        state: "RUNNING"
      },
      {
        missionId: "mission_live_reconciliation_watch",
        title: "Surveiller delta CLN5 non critique",
        ownerAgent: "Jarvis Supervisor",
        state: "WAITING"
      }
    ],
    morningBrief: [
      {
        sectionId: "brief_research",
        domain: "Research",
        status: "OK",
        headline: "7 expériences actives, 1 stratégie en revue",
        detail: "GC Macro Impulse approche la promotion shadow ; MNQ OOS fold 18/24 en cours.",
        sourceIds: ["src_research_lab", "src_strategy_center"]
      },
      {
        sectionId: "brief_live",
        domain: "Live",
        status: "WATCH",
        headline: "Live déterministe nominal avec 1 reconciliation watch",
        detail: "Signal MNQ accepté, risque PASS ; CLN5 delta non bloquant à surveiller.",
        sourceIds: ["src_live_trading", "src_portfolio"]
      },
      {
        sectionId: "brief_execution",
        domain: "Execution",
        status: "WATCH",
        headline: "Provider shadow dégradé",
        detail: "PickMyTrade shadow en latence 88 ms ; Ninja Sim101 reste primary paper.",
        sourceIds: ["src_live_providers"]
      }
    ],
    suggestions: [
      {
        suggestionId: "sug_confirm_reconciliation",
        title: "Lancer une reconciliation ciblée",
        impact: "Vérifie providers et incident CLN5 sans modifier ordre ni position.",
        sourceIds: ["src_live_trading", "src_live_providers"],
        pendingActionId: "act_confirm_live_reconciliation"
      },
      {
        suggestionId: "sug_review_gc_shadow",
        title: "Préparer revue GC Macro Impulse",
        impact: "Ouvre Strategy Center avec la version candidate et les gates.",
        sourceIds: ["src_strategy_center"]
      },
      {
        suggestionId: "sug_monitor_news_fallback",
        title: "Surveiller couverture news",
        impact: "Le fallback 48h suffit, ForexFactory reste à brancher.",
        sourceIds: ["src_research_lab"]
      }
    ],
    conversation: [
      {
        messageId: "msg_operator_001",
        role: "operator",
        at: "2026-08-10T09:38:30.000Z",
        text: "Donne-moi le brief opérateur avant l’ouverture.",
        citationIds: []
      },
      {
        messageId: "msg_jarvis_001",
        role: "jarvis",
        at: "2026-08-10T09:38:34.000Z",
        text: "Desk nominal. Research actif, live prêt, execution surveille un delta CLN5 non bloquant. Aucune action urgente.",
        citationIds: ["src_command_center", "src_live_trading", "src_research_lab"]
      },
      {
        messageId: "msg_jarvis_002",
        role: "jarvis",
        at: "2026-08-10T09:40:12.000Z",
        text: "Je peux proposer une reconciliation ciblée. Elle restera une commande BFF confirmée, sans accès direct au moteur.",
        citationIds: ["src_live_providers"]
      }
    ],
    citations: [
      { citationId: "src_command_center", label: "Command Center snapshot", route: "/command-center", freshness: "fresh" },
      { citationId: "src_research_lab", label: "Research Lab projection", route: "/research", freshness: "fresh" },
      { citationId: "src_strategy_center", label: "Strategy Center projection", route: "/strategies", freshness: "fresh" },
      { citationId: "src_live_trading", label: "Live Trading snapshot", route: "/live", freshness: "fresh" },
      { citationId: "src_live_providers", label: "Provider health", route: "/execution/providers", freshness: "degraded" },
      { citationId: "src_portfolio", label: "Portfolio exposure", route: "/portfolio", freshness: "fresh" }
    ],
    deskSnapshot: {
      riskUsedPct: 37.6,
      liveSignals: 14,
      researchExperiments: 7,
      providersOk: 1,
      providersTotal: 2,
      openIncidents: 1
    },
    pendingActions: [
      {
        actionId: "act_confirm_live_reconciliation",
        title: "Confirmer reconciliation Live",
        impact: "Crée une commande async pour contrôler provider health et incident CLN5. Aucun ordre n’est créé.",
        permission: "ALLOWED",
        requiresConfirmation: true,
        commandType: "live.reconciliation.request",
        payload: {
          sessionId: "live_session_2026_08_10_ny",
          incidentId: "inc_live_broker_netting_cl_delta",
          providerPrimary: "provider_ninjatrader_sim101"
        }
      }
    ],
    alerts: [
      { alertId: "alert_voice_degraded", severity: "MEDIUM", title: "Voice service en mode dégradé", route: "/jarvis" },
      { alertId: "alert_pickmytrade_shadow", severity: "MEDIUM", title: "PickMyTrade shadow dégradé", route: "/execution/providers" }
    ],
    voice: {
      pushToTalkAvailable: false,
      serviceStatus: "DEGRADED",
      degradationReason: "Voice relay indisponible en préprod locale",
      lastTranscript: "Brief opérateur avant ouverture"
    },
    commands: [
      { commandId: "cmd_mock_live_reconcile_prev", status: "SUCCEEDED", title: "Reconciliation provider précédente" },
      { commandId: "cmd_mock_strategy_shadow_prev", status: "ACCEPTED", title: "Shadow test Strategy Center" }
    ]
  }
};

export const operationsQueueView: ViewEnvelope<OperationsQueueView> = {
  meta: commonMeta,
  permissions: commonPermissions,
  data: {
    summary: {
      activeMissions: 5,
      waitingEvents: 4,
      blockedGates: 1,
      retryBacklog: 2,
      dlqItems: 1,
      budgetUsedPct: 62
    },
    missions: [
      {
        missionId: "mission_research_mnq_breakout_retest_20260810",
        title: "Valider MNQ Breakout Retest OOS",
        ownerAgent: "OOS Validator",
        currentTask: "Fold 18/24 · recalcul costs/slippage",
        state: "RUNNING",
        expectedEvent: "simulation.run.completed",
        receivedEvent: "simulation.batch.progressed",
        nextTransition: "PROMOTION_REVIEW_PENDING",
        policyGate: "PASS",
        tokenBudgetPct: 48,
        computeBudgetPct: 66,
        retryCount: 0,
        maxRetries: 3,
        correlationId: "corr_research_mnq_oos_20260810"
      },
      {
        missionId: "mission_vnext_provider_shadow",
        title: "Comparer NinjaTrader et PickMyTrade en shadow",
        ownerAgent: "Research Reviewer",
        currentTask: "Collecte fills simulés et latence provider",
        state: "WAITING_EVENT",
        expectedEvent: "provider.shadow.reconciliation.completed",
        receivedEvent: "provider.shadow.started",
        nextTransition: "PROVIDER_DUE_DILIGENCE_UPDATE",
        policyGate: "WATCH",
        tokenBudgetPct: 35,
        computeBudgetPct: 28,
        retryCount: 1,
        maxRetries: 3,
        correlationId: "corr_provider_shadow_20260810"
      },
      {
        missionId: "mission_live_reconciliation_watch",
        title: "Surveiller delta CLN5 non critique",
        ownerAgent: "Jarvis Supervisor",
        currentTask: "Attente reconciliation provider health",
        state: "OPERATOR_GATE_REQUIRED",
        expectedEvent: "command.live.reconciliation.accepted",
        nextTransition: "RECONCILIATION_AUDIT",
        policyGate: "OPERATOR_GATE_REQUIRED",
        tokenBudgetPct: 22,
        computeBudgetPct: 18,
        retryCount: 0,
        maxRetries: 2,
        correlationId: "corr_live_reconcile_cln5_20260810"
      },
      {
        missionId: "mission_news_fallback_quality",
        title: "Contrôler fallback news 48h",
        ownerAgent: "Data Scout",
        currentTask: "Vérifier fraîcheur ForexFactory/GDELT",
        state: "RETRYING",
        expectedEvent: "macro.news.coverage.refreshed",
        receivedEvent: "macro.news.coverage.degraded",
        nextTransition: "DATA_QUALITY_RECHECK",
        policyGate: "WATCH",
        tokenBudgetPct: 74,
        computeBudgetPct: 31,
        retryCount: 2,
        maxRetries: 4,
        correlationId: "corr_news_fallback_20260810"
      },
      {
        missionId: "mission_legacy_replay_archive",
        title: "Archiver replay legacy 60m",
        ownerAgent: "Knowledge Curator",
        currentTask: "DLQ export retention proof",
        state: "DLQ",
        expectedEvent: "archive.retention.proof.created",
        receivedEvent: "archive.export.failed",
        nextTransition: "OPERATOR_GATE_REQUIRED",
        policyGate: "BLOCKED",
        tokenBudgetPct: 12,
        computeBudgetPct: 9,
        retryCount: 3,
        maxRetries: 3,
        correlationId: "corr_replay_legacy_archive_20260810"
      }
    ],
    eventFlow: [
      {
        eventId: "evt_oos_fold_progressed",
        correlationId: "corr_research_mnq_oos_20260810",
        at: "2026-08-10T09:33:05.000Z",
        eventType: "simulation.batch.progressed",
        domain: "RESEARCH",
        status: "RECEIVED",
        latencyMs: 840,
        missionId: "mission_research_mnq_breakout_retest_20260810"
      },
      {
        eventId: "evt_oos_run_expected",
        correlationId: "corr_research_mnq_oos_20260810",
        causationId: "evt_oos_fold_progressed",
        at: "2026-08-10T09:41:00.000Z",
        eventType: "simulation.run.completed",
        domain: "RESEARCH",
        status: "EXPECTED",
        latencyMs: 0,
        missionId: "mission_research_mnq_breakout_retest_20260810"
      },
      {
        eventId: "evt_provider_shadow_started",
        correlationId: "corr_provider_shadow_20260810",
        at: "2026-08-10T09:31:12.000Z",
        eventType: "provider.shadow.started",
        domain: "EXECUTION",
        status: "RECEIVED",
        latencyMs: 112,
        missionId: "mission_vnext_provider_shadow"
      },
      {
        eventId: "evt_live_reconcile_expected",
        correlationId: "corr_live_reconcile_cln5_20260810",
        at: "2026-08-10T09:42:00.000Z",
        eventType: "command.live.reconciliation.accepted",
        domain: "LIVE",
        status: "EXPECTED",
        latencyMs: 0,
        missionId: "mission_live_reconciliation_watch"
      },
      {
        eventId: "evt_news_degraded",
        correlationId: "corr_news_fallback_20260810",
        at: "2026-08-10T09:28:45.000Z",
        eventType: "macro.news.coverage.degraded",
        domain: "SYSTEM",
        status: "STALE",
        latencyMs: 4380,
        missionId: "mission_news_fallback_quality"
      },
      {
        eventId: "evt_archive_export_failed",
        correlationId: "corr_replay_legacy_archive_20260810",
        at: "2026-08-10T09:24:01.000Z",
        eventType: "archive.export.failed",
        domain: "SYSTEM",
        status: "BLOCKED",
        latencyMs: 2900,
        missionId: "mission_legacy_replay_archive"
      }
    ],
    policyGates: [
      {
        gateId: "gate_no_human_assignment",
        label: "Autonomous ownership",
        state: "PASS",
        reason: "Chaque mission expose un ownerAgent IA et une transition automatique.",
        missionId: "mission_research_mnq_breakout_retest_20260810"
      },
      {
        gateId: "gate_provider_shadow_watch",
        label: "Provider shadow due diligence",
        state: "WATCH",
        reason: "PickMyTrade shadow est dégradé mais non autoritaire.",
        missionId: "mission_vnext_provider_shadow"
      },
      {
        gateId: "gate_live_reconcile_operator",
        label: "Operator gate exceptionnel",
        state: "OPERATOR_GATE_REQUIRED",
        reason: "Réconciliation ciblée requiert confirmation UI et Command Runtime.",
        missionId: "mission_live_reconciliation_watch"
      },
      {
        gateId: "gate_archive_retention_blocked",
        label: "Retention proof missing",
        state: "BLOCKED",
        reason: "Export legacy échoué après max retries, DLQ visible.",
        missionId: "mission_legacy_replay_archive"
      }
    ],
    deadLetters: [
      {
        dlqId: "dlq_archive_legacy_60m",
        missionId: "mission_legacy_replay_archive",
        reason: "ARCHIVE_EXPORT_FAILED",
        retryable: false,
        lastErrorCode: "RETENTION_PROOF_MISSING",
        ageMinutes: 16
      },
      {
        dlqId: "dlq_news_gdelt_rate_limit",
        missionId: "mission_news_fallback_quality",
        reason: "GDELT_RATE_LIMITED",
        retryable: true,
        lastErrorCode: "HTTP_429_BACKOFF",
        ageMinutes: 7
      }
    ],
    incidents: [
      {
        incidentId: "inc_provider_shadow_latency",
        severity: "MEDIUM",
        title: "Provider shadow latence > seuil",
        domain: "EXECUTION",
        missionId: "mission_vnext_provider_shadow",
        route: "/execution/providers"
      },
      {
        incidentId: "inc_archive_retention_blocked",
        severity: "HIGH",
        title: "Archive legacy DLQ bloquante",
        domain: "SYSTEM",
        missionId: "mission_legacy_replay_archive",
        route: "/events"
      }
    ],
    commandActions: [
      {
        actionId: "act_retry_news_coverage",
        label: "Réessayer la couverture actualités",
        missionId: "mission_news_fallback_quality",
        commandType: "operations.job.retry",
        permission: "ALLOWED",
        requiresConfirmation: true,
        payload: {
          missionId: "mission_news_fallback_quality",
          dlqId: "dlq_news_gdelt_rate_limit"
        }
      },
      {
        actionId: "act_pause_provider_shadow",
        label: "Pause provider shadow",
        missionId: "mission_vnext_provider_shadow",
        commandType: "operations.mission.pause",
        permission: "STEP_UP_REQUIRED",
        requiresConfirmation: true,
        payload: {
          missionId: "mission_vnext_provider_shadow",
          reasonCode: "PROVIDER_LATENCY_WATCH"
        }
      },
      {
        actionId: "act_request_machine_review",
        label: "Re-review machine",
        missionId: "mission_legacy_replay_archive",
        commandType: "operations.machine_review.request",
        permission: "ALLOWED",
        requiresConfirmation: true,
        payload: {
          missionId: "mission_legacy_replay_archive",
          gateId: "gate_archive_retention_blocked"
        }
      }
    ]
  }
};

export const eventsAuditView: ViewEnvelope<EventsAuditView> = {
  meta: commonMeta,
  permissions: commonPermissions,
  data: {
    summary: {
      totalEvents: 10,
      correlations: 4,
      avgLatencyMs: 612,
      authoritativeSteps: 9,
      advisoryBranches: 1,
      exportablePayloads: 7
    },
    filters: {
      activeCorrelationId: "corr_live_reconcile_cln5_20260810",
      windowLabel: "Aujourd’hui · 09:39–09:41",
      domains: ["STRATEGY", "LIVE", "PORTFOLIO", "RISK", "EXECUTION", "SYSTEM"],
      statuses: ["OK", "WATCH", "EXPECTED"]
    },
    events: [
      {
        eventId: "evt_strategy_runtime_signal",
        correlationId: "corr_live_reconcile_cln5_20260810",
        at: "2026-08-10T09:40:55.000Z",
        eventType: "strategy.signal.created",
        domain: "STRATEGY",
        lane: "AUTHORITATIVE",
        status: "OK",
        latencyMs: 18,
        schemaVersion: "1.4.0",
        route: "/live/signals/sig_vnext_demo_mnq_0940"
      },
      {
        eventId: "evt_signal_bus_published",
        correlationId: "corr_live_reconcile_cln5_20260810",
        causationId: "evt_strategy_runtime_signal",
        at: "2026-08-10T09:40:55.160Z",
        eventType: "signal.bus.published",
        domain: "LIVE",
        lane: "AUTHORITATIVE",
        status: "OK",
        latencyMs: 160,
        schemaVersion: "1.2.0",
        route: "/live"
      },
      {
        eventId: "evt_ai_context_advisory_created",
        correlationId: "corr_live_reconcile_cln5_20260810",
        causationId: "evt_signal_bus_published",
        at: "2026-08-10T09:40:55.240Z",
        eventType: "ai.context.advisory.created",
        domain: "JARVIS",
        lane: "ADVISORY",
        status: "WATCH",
        latencyMs: 80,
        schemaVersion: "1.0.0",
        route: "/jarvis"
      },
      {
        eventId: "evt_portfolio_arbitration_completed",
        correlationId: "corr_live_reconcile_cln5_20260810",
        causationId: "evt_signal_bus_published",
        at: "2026-08-10T09:40:56.000Z",
        eventType: "portfolio.arbitration.completed",
        domain: "PORTFOLIO",
        lane: "AUTHORITATIVE",
        status: "OK",
        latencyMs: 840,
        schemaVersion: "2.1.0",
        route: "/portfolio"
      },
      {
        eventId: "evt_global_risk_passed",
        correlationId: "corr_live_reconcile_cln5_20260810",
        causationId: "evt_portfolio_arbitration_completed",
        at: "2026-08-10T09:40:56.220Z",
        eventType: "global.risk.passed",
        domain: "RISK",
        lane: "AUTHORITATIVE",
        status: "OK",
        latencyMs: 220,
        schemaVersion: "1.7.0",
        route: "/risk"
      },
      {
        eventId: "evt_broker_netting_completed",
        correlationId: "corr_live_reconcile_cln5_20260810",
        causationId: "evt_global_risk_passed",
        at: "2026-08-10T09:40:56.690Z",
        eventType: "broker.netting.completed",
        domain: "EXECUTION",
        lane: "AUTHORITATIVE",
        status: "WATCH",
        latencyMs: 470,
        schemaVersion: "1.3.0",
        route: "/orders"
      },
      {
        eventId: "evt_order_intent_created",
        correlationId: "corr_live_reconcile_cln5_20260810",
        causationId: "evt_broker_netting_completed",
        at: "2026-08-10T09:40:57.040Z",
        eventType: "order.intent.created",
        domain: "EXECUTION",
        lane: "AUTHORITATIVE",
        status: "OK",
        latencyMs: 350,
        schemaVersion: "1.5.0",
        route: "/orders"
      },
      {
        eventId: "evt_execution_gateway_accepted",
        correlationId: "corr_live_reconcile_cln5_20260810",
        causationId: "evt_order_intent_created",
        at: "2026-08-10T09:40:57.510Z",
        eventType: "execution.gateway.accepted",
        domain: "EXECUTION",
        lane: "AUTHORITATIVE",
        status: "OK",
        latencyMs: 470,
        schemaVersion: "1.6.0",
        route: "/execution/providers"
      },
      {
        eventId: "evt_provider_order_ack",
        correlationId: "corr_live_reconcile_cln5_20260810",
        causationId: "evt_execution_gateway_accepted",
        at: "2026-08-10T09:40:58.260Z",
        eventType: "provider.order.ack",
        domain: "EXECUTION",
        lane: "AUTHORITATIVE",
        status: "OK",
        latencyMs: 750,
        schemaVersion: "1.6.0",
        route: "/execution/providers"
      },
      {
        eventId: "evt_reconciliation_completed",
        correlationId: "corr_live_reconcile_cln5_20260810",
        causationId: "evt_provider_order_ack",
        at: "2026-08-10T09:41:02.000Z",
        eventType: "broker.reconciliation.completed",
        domain: "SYSTEM",
        lane: "AUTHORITATIVE",
        status: "WATCH",
        latencyMs: 3740,
        schemaVersion: "1.8.0",
        route: "/operations"
      }
    ],
    selectedCorrelation: {
      correlationId: "corr_live_reconcile_cln5_20260810",
      rootEventId: "evt_strategy_runtime_signal",
      totalLatencyMs: 7020,
      authoritativePath: [
        "evt_strategy_runtime_signal",
        "evt_signal_bus_published",
        "evt_portfolio_arbitration_completed",
        "evt_global_risk_passed",
        "evt_broker_netting_completed",
        "evt_order_intent_created",
        "evt_execution_gateway_accepted",
        "evt_provider_order_ack",
        "evt_reconciliation_completed"
      ],
      advisoryPath: ["evt_ai_context_advisory_created"],
      payloadPreview: [
        { key: "signalId", value: signalId },
        { key: "strategyInstanceId", value: strategyInstanceId },
        { key: "symbol", value: "MNQ" },
        { key: "providerId", value: "provider_ninjatrader_sim101" },
        { key: "orderId", value: "ord_sig_vnext_demo_mnq_0940_001" },
        { key: "riskRule", value: "RISK_025_NET_CAPITAL_OK" }
      ],
      logs: [
        {
          logId: "log_corr_094055_signal",
          level: "INFO",
          message: "Signal Strategy Runtime publié et dédupliqué par signalId."
        },
        {
          logId: "log_corr_094056_ai_shadow",
          level: "WARN",
          message: "AI advisory attaché en shadow, exclu du chemin d’ordre autoritaire."
        },
        {
          logId: "log_corr_094102_reconcile",
          level: "INFO",
          message: "Réconciliation broker terminée avec statut WATCH non bloquant."
        }
      ]
    },
    relations: [
      { fromEventId: "evt_strategy_runtime_signal", toEventId: "evt_signal_bus_published", relation: "CAUSES" },
      { fromEventId: "evt_signal_bus_published", toEventId: "evt_ai_context_advisory_created", relation: "ADVISES" },
      { fromEventId: "evt_signal_bus_published", toEventId: "evt_portfolio_arbitration_completed", relation: "CAUSES" },
      { fromEventId: "evt_portfolio_arbitration_completed", toEventId: "evt_global_risk_passed", relation: "CAUSES" },
      { fromEventId: "evt_global_risk_passed", toEventId: "evt_broker_netting_completed", relation: "CAUSES" },
      { fromEventId: "evt_broker_netting_completed", toEventId: "evt_order_intent_created", relation: "CAUSES" },
      { fromEventId: "evt_order_intent_created", toEventId: "evt_execution_gateway_accepted", relation: "CAUSES" },
      { fromEventId: "evt_execution_gateway_accepted", toEventId: "evt_provider_order_ack", relation: "CAUSES" },
      { fromEventId: "evt_provider_order_ack", toEventId: "evt_reconciliation_completed", relation: "FOLLOWS" }
    ],
    commandActions: [
      {
        actionId: "act_events_export_corr_live",
        label: "Exporter audit",
        commandType: "events.audit.export",
        permission: "ALLOWED",
        requiresConfirmation: true,
        payload: {
          correlationId: "corr_live_reconcile_cln5_20260810",
          format: "jsonl",
          includePayloads: true
        }
      },
      {
        actionId: "act_events_copy_payload",
        label: "Copier payload",
        commandType: "events.payload.copy",
        permission: "ALLOWED",
        requiresConfirmation: false,
        payload: {
          correlationId: "corr_live_reconcile_cln5_20260810",
          eventId: "evt_order_intent_created"
        }
      },
      {
        actionId: "act_events_reconstruct_path",
        label: "Reconstruire chemin",
        commandType: "events.correlation.reconstruct",
        permission: "STEP_UP_REQUIRED",
        requiresConfirmation: true,
        payload: {
          correlationId: "corr_live_reconcile_cln5_20260810",
          deterministicOnly: true
        }
      }
    ]
  }
};

export const canonicalViewDataset = {
  "auth-session": authSessionView,
  "operator-settings": operatorSettingsView,
  "admin-access": adminAccessView,
  "command-center": commandCenterView,
  "demo-paper-readiness": demoPaperReadinessView,
  "events-audit": eventsAuditView,
  "operations-queue": operationsQueueView,
  "research-agent-fleet": researchAgentFleetView,
  "research-compute-scheduler": researchComputeSchedulerView,
  "research-data-catalog": researchDataCatalogView,
  "research-experiment-detail": researchExperimentDetailView,
  "research-run-detail": researchRunDetailView,
  "research-lab": researchLabView,
  "strategy-center": strategyCenterView,
  "strategy-detail": strategyDetailView,
  "strategy-compare": strategyCompareView,
  "live-trading": liveTradingView,
  "live-signal-detail": liveSignalDetailView,
  orders: ordersView,
  risk: riskView,
  "execution-providers": executionProvidersView,
  "execution-incidents": executionIncidentsView,
  portfolio: portfolioView,
  "jarvis-workspace": jarvisWorkspaceView
} as const;
