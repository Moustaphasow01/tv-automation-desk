export type PortfolioPosition = {
  positionId: string;
  strategyInstanceId: string;
  symbol: string;
  side: "LONG" | "SHORT" | "FLAT";
  quantity: number;
  virtualR: number;
  brokerQuantity: number;
  reconciliation: "MATCHED" | "DELTA" | "PENDING";
};

export type ExposureTreeItem = {
  id: string;
  label: string;
  group: "Index" | "Rates" | "Metals" | "Energy" | "FX";
  side: "LONG" | "SHORT" | "NET";
  valueUsd: number;
  weightPct: number;
};

export type BrokerPosition = {
  positionId: string;
  account: string;
  instrument: string;
  side: "LONG" | "SHORT" | "FLAT";
  quantity: number;
  averagePrice: number;
  markPrice: number;
  unrealizedPnl: number;
  riskR: number;
  protectionStatus: "PROTECTED" | "UNPROTECTED" | "PENDING";
  reconciliationStatus: "MATCHED" | "PENDING" | "MISMATCH";
};

export type CorrelationMatrix = {
  instruments: readonly string[];
  cells: readonly {
    from: string;
    to: string;
    value: number;
  }[];
  topPair: string;
  portfolioCorrelation: number;
  diversificationScore: number;
};

export type VirtualAllocation = {
  allocationId?: string;
  strategyInstanceId: string;
  strategyName: string;
  instrument: string;
  virtualQuantity: number;
  exposureUsd: number;
  attributedPnlR: number;
  riskPct: number;
  executionMode: "SHADOW" | "PAPER" | "LIVE";
  health: "OK" | "WATCH" | "DEGRADED";
};

export type BrokerNettingReconciliation = {
  status: "SYNCHRO" | "PENDING" | "MISMATCH" | "CRITICAL";
  targetDeskQuantity: number;
  brokerRealQuantity: number;
  deltaQuantity: number;
  asOf: string;
  ordersInFlight: number;
  graceUntil?: string;
};

export type PnlRiskAttribution = {
  bestContributor: string;
  top3RiskPct: number;
  diversificationScore: number;
  items: readonly {
    strategyInstanceId: string;
    label: string;
    pnlR: number;
    riskPct: number;
  }[];
};

import type { DataValue } from "@/shared/contracts";

export type PortfolioView = {
  summary: {
    equity: number;
    grossExposureUsd: number;
    netExposureUsd: number;
    unrealizedPnl: number;
    riskUsedPct: number;
    correlatedExposurePct: number;
    netLiquidation: number;
    dailyR: number;
    exposureUsd: number;
    maxDrawdownR: number;
    openPositions: number;
    riskUsagePct: number;
    positionsLong: number;
    positionsShort: number;
    strategiesWithPositions: number;
    humanGatePending: number;
    pendingOrders: number;
  };
  summaryTruth: {
    equity: DataValue<number>;
    grossExposureUsd: DataValue<number>;
    netExposureUsd: DataValue<number>;
    unrealizedPnl: DataValue<number>;
    riskUsedPct: DataValue<number>;
    correlatedExposurePct: DataValue<number>;
  };
  equityCurve: readonly number[];
  accountsSummary: readonly {
    accountId: string;
    label: string;
    mode: string;
    equity: number | null;
    openPnl: number | null;
    openPositions: number;
    asOf: string | null;
  }[];
  positions: readonly PortfolioPosition[];
  exposureTree: readonly ExposureTreeItem[];
  brokerPositions: readonly BrokerPosition[];
  correlationMatrix: CorrelationMatrix;
  virtualAllocations: readonly VirtualAllocation[];
  reconciliation: BrokerNettingReconciliation;
  attribution: PnlRiskAttribution;
  timeline: readonly {
    id: string;
    at: string;
    title: string;
    description: string;
  }[];
};

export type CommandCenterView = {
  mode: {
    environment: string;
    executionMode: string;
    autoExecution: "ON" | "OFF" | "UNKNOWN";
    liveBroker: "ON" | "OFF" | "UNKNOWN";
    autoExecutionEnabled?: boolean;
    physicalExecutionEnabled?: boolean;
    humanGateRequired?: boolean;
    providerSubmissionEnabled?: boolean;
    release: string;
    marketData: string;
  };
  summary: {
    deskStatus: "NOMINAL" | "DEGRADED" | "STOPPED" | "UNKNOWN";
    activeStrategies: number | null;
    activeResearchAgents: number | null;
    expectedResearchAgents: number | null;
    criticalIncidents: number | null;
    pendingCommands: number | null;
    providerSafety: string;
  };
  systems: readonly {
    id: string;
    label: string;
    status: "OK" | "DEGRADED" | "DOWN" | "FRESH" | "STALE" | "UNAVAILABLE";
    detail: string;
    latencyMs: number | null;
  }[];
  activity: readonly CommandCenterActivity[];
  risk: {
    capitalStatus: "NORMAL" | "WATCH" | "STOP" | "UNKNOWN";
    riskUsagePct: number | null;
    maxDrawdownR: number | null;
    openPositions: number | null;
    healthyLimits: number | null;
    totalLimits: number | null;
    activeAlerts: number | null;
  };
  lanes: readonly {
    id: string;
    label: string;
    detail: string;
    completed: number;
    total: number;
    state: "NOMINAL" | "WATCH";
  }[];
  upcoming: readonly {
    id: string;
    time: string;
    title: string;
    detail: string;
    tone: "INFO" | "WATCH" | "HIGH";
  }[];
  market: CommandCenterMarket;
  research: CommandCenterResearch;
  signals: {
    available: boolean;
    rows: readonly CommandCenterSignal[];
  };
  humanGate: {
    available: boolean;
    availability?: string;
    source?: string;
    rows: readonly CommandCenterOrderIntent[];
  };
  provider: CommandCenterProvider;
  performance: {
    available: boolean;
    pnlR: number | null;
    trades: number | null;
    maxDrawdownR: number | null;
    curve: readonly number[];
  };
  incidents: readonly CommandCenterIncident[];
  operations: {
    availability: string;
    queuedTasks: number | null;
    dlqItems: number | null;
    staleFeeds: number | null;
  };
  assistant: {
    available: boolean;
    activeWorkers: number | null;
    expectedWorkers: number | null;
    runningTasks: number | null;
    latest: readonly { id: string; role: string; status: string }[];
  };
  audit: readonly CommandCenterAuditEvent[];
};

export type CommandCenterMarket = {
  status: string;
  freshnessSeconds: number | null;
  rows: readonly {
    id: string;
    instrument: string;
    timeframe: string;
    source: string;
    asOf: string;
    freshnessSeconds: number | null;
    status: string;
  }[];
};

export type CommandCenterResearch = {
  available: boolean;
  hypothesisCount: number | null;
  experimentCount: number | null;
  runCount: number | null;
  candidateCount: number | null;
  activeWorkers: number | null;
  expectedWorkers: number | null;
  datasetCount: number | null;
  artifactCount: number | null;
  rows: readonly {
    id: string;
    mission: string;
    dataset: string;
    run: string;
    status: string;
    workers: number | null;
    artifacts: number | null;
  }[];
};

export type CommandCenterSignal = {
  id: string;
  at: string;
  instrument: string;
  setup: string;
  confidence: number | null;
  gate: string;
  portfolioDecision: string;
  riskDecision: string;
};

export type CommandCenterOrderIntent = {
  orderIntentId: string;
  instrument: string;
  side: string;
  quantity: number | null;
  executionMode: string;
  status: string;
  allowedActions: readonly string[];
  ageSeconds: number | null;
};

export type CommandCenterProvider = {
  available: boolean;
  availability?: string;
  mode: string;
  circuitBreaker: string;
  health: string;
  physicalExecutionPolicy?: string;
  source?: string;
  ackLatencyMs: number | null;
  mismatchCount: number | null;
  events: readonly {
    id: string;
    at: string;
    stage: string;
    detail: string;
    status: string;
  }[];
};

export type CommandCenterIncident = {
  id: string;
  severity: string;
  detectedAt: string;
  resource: string;
  title: string;
  runbook: string;
  action: string;
};

export type CommandCenterAuditEvent = {
  id: string;
  at: string;
  eventType: string;
  detail: string;
  actor: string;
  status: string;
};

export type CommandCenterActivity = {
  id: string;
  time: string;
  domain: string;
  label: string;
  detail: string;
  duration: string;
  state: "RUNNING" | "DONE" | "WATCH";
};

export type LiveTheoreticalExecutionRow = {
  portfolioOrderIntentId: string;
  targetPositionId: string;
  strategySignalId: string;
  strategyId: string;
  strategyInstanceId: string;
  instrument: string;
  side: string;
  orderType: string;
  quantity: number | null;
  entry: number | null;
  stop: number | null;
  targets: readonly { label: string; price: number | null; ratioR: number | null }[];
  expectedR: number | null;
  status: string;
  latestEventType: string;
  latestEventAt: string;
  entryFilledAt: string;
  entryFillPrice: number | null;
  exitAt: string;
  exitPrice: number | null;
  resultR: number | null;
  tradeId: string;
  tradeStatus: string;
  sourceCandleAt: string;
  sourceTimeframe: string;
  physicalExecutionCreated: boolean;
  brokerEvidence: string;
};

export type LiveTradingView = {
  summary: {
    signalsToday: number;
    tradesExecuted: number;
    acceptanceRatePct: number | null;
    orderIntentsPending?: number;
    providerCommandsCreated?: number;
    providerEventsObserved?: number;
    riskUsedPct: number | null;
    correlatedExposurePct: number | null;
    liveDrawdownR: number | null;
  };
  session: {
    sessionId: string;
    tradingDate: string;
    phase: string;
    nextMonitorAt: string;
    marketDataStatus: "LIVE" | "DELAYED" | "STALE" | "DOWN";
    marketState?: string;
    activeSession?: string;
    exchangeTimezone?: string;
    lastKnownAt?: string;
  };
  launchGate: {
    status: "READY" | "BLOCKED";
    finalDecision: "OPEN_DEMO_PAPER_AGENTS_ALLOWED" | "KEEP_AGENTS_CLOSED_OR_SHADOW";
    checkedAt: string;
    finalCheckCommand: string;
    releaseCheckCommand: string;
    components: readonly {
      componentId: string;
      label: string;
      status: "READY" | "BLOCKED" | "VERIFY_WITH_RELEASE_GATE";
      blockers: readonly string[];
    }[];
    checks: readonly {
      id: string;
      label: string;
      ok: boolean;
      detail: string;
      domain: string;
    }[];
    blockers: readonly {
      id: string;
      title: string;
      severity: "BLOCKER";
      domain: string;
      evidence: string;
      action: string;
    }[];
    operatorActions: readonly {
      id: string;
      blockerId: string;
      title: string;
      severity: "BLOCKER";
      evidence: string;
      action: string;
      command: string | null;
      route: string;
    }[];
  };
  pipeline: readonly {
    stepId:
      | "MARKET_DATA"
      | "FEATURE_ENGINE"
      | "STRATEGY_RUNTIME"
      | "SIGNAL_BUS"
      | "ARBITRATION"
      | "GLOBAL_RISK"
      | "BROKER_NETTING"
      | "ORDER_INTENT"
      | "EXECUTION_GATEWAY"
      | "PROVIDER"
      | "BROKER"
      | "RECONCILIATION";
    label: string;
    status: "OK" | "RUNNING" | "WATCH" | "BLOCKED";
    latencyMs: number;
    detail: string;
  }[];
  canonicalRuntime: {
    schemaVersion: string;
    mode: {
      environment: "PAPER" | "LIVE" | "SHADOW" | "MOCK";
      executionMode: "SHADOW" | "SEMI_MANUAL" | "PAPER" | "LIVE";
      autoExecutionEnabled: boolean;
      physicalExecutionEnabled: boolean;
      humanGateRequired: boolean;
      ackIsFill: boolean;
    };
    authoritativeSources: readonly {
      source: string;
      rows: number;
      latestAt: string | null;
    }[];
    freshness: {
      marketData: string;
      signalCutoffAt: string | null;
      contextDecisionAt: string | null;
      orderIntentAt: string | null;
      asOf: string;
    };
    pipeline: readonly {
      stepId: string;
      label: string;
      status: string;
      detail: string;
      source: string;
    }[];
    activeStrategyInstances: readonly {
      strategyInstanceId: string;
      strategyDefinitionId: string;
      strategyVersionId: string;
      name: string | null;
      executionMode: string;
      runtimeState: string;
      lastEvaluationAt: string;
      nextEvaluationAt: string;
      scheduler: unknown;
      confidence: number | null;
      confidenceSourceSignalId: string | null;
    }[];
    latestSignals: readonly LiveTradingView["signals"][number][];
    aiContextGate: readonly {
      decisionId: string;
      signalId?: string | null;
      status: string;
      mode: string;
      recommendation: string;
      confidence: number | null;
      riskMultiplier: number | null;
      reasonCodes: readonly string[];
      anomalies: readonly string[];
      decidedAt: string;
    }[];
    pendingOrderIntents: readonly LivePortfolioOrderIntent[];
    pendingTargetPositions: readonly Record<string, unknown>[];
    riskCenter: LiveRiskCenter;
  };
  marketSeries?: {
    schemaVersion?: string;
    availability: string;
    source: string;
    sourceClass?: string;
    instrument?: string | null;
    timeframe?: string | null;
    supportedInstruments?: readonly string[];
    supportedTimeframes: readonly string[];
    asOf: string | null;
    points: readonly {
      timestamp: string;
      tradingDate?: string | null;
      open: number | null;
      high: number | null;
      low: number | null;
      close: number | null;
      volume: number | null;
      vwap: number | null;
      source?: string;
    }[];
    page?: { limit: number; hasMore: boolean; nextCursor: string | null };
    antiLookahead?: boolean;
    reason?: string;
  };
  watchlist?: readonly {
    symbol: string;
    last: number | null;
    changePct: number | null;
    trend: readonly number[];
    asOf: string;
    availability: string;
  }[];
  macroSession?: Record<string, unknown>;
  reconciliation?: {
    availability: string;
    status: string;
    mismatchCount: number | null;
    expected: Record<string, unknown> | null;
    broker: Record<string, unknown> | null;
    asOf: string | null;
    reason: string | null;
    source: string;
  };
  theoreticalExecution?: {
    schemaVersion: string;
    availability: string;
    status: string;
    source: string;
    asOf: string | null;
    summary: {
      trackedIntents: number;
      working: number;
      entryFilled: number;
      targetHit: number;
      stopHit: number;
      expired: number;
      reviewRequired: number;
      openTrades: number;
      closedTrades: number;
      totalClosedR: number;
    };
    rows: readonly LiveTheoreticalExecutionRow[];
  };
  performanceR?: {
    availability: string;
    sourceType: string;
    totalR: number | null;
    dailyR: number | null;
    drawdownR: number | null;
    sampleSize: number | null;
    hitRatePct: number | null;
    series: readonly {
      sequence: number;
      at: string;
      resultR: number;
      cumulativeR: number;
      drawdownR: number;
    }[];
    asOf: string;
  };
  signals: readonly {
    signalId: string;
    strategyId: string;
    strategyVersionId: string;
    strategyInstanceId: string;
    symbol: string;
    direction: "LONG" | "SHORT";
    state: "NEW" | "ARBITRATED" | "REJECTED" | "ORDERED" | "FILLED" | "EXPIRED";
    confidence: number;
    createdAt: string;
    expiresAt: string;
    timeframe?: string | null;
    session?: string | null;
    sourceDataCutoffAt?: string | null;
    featureSnapshotId: string;
    ruleHits: readonly string[];
    expectancyR: number;
    rewardRisk: number;
    regime: string;
    setup?: Record<string, unknown> | null;
    predicates?: readonly unknown[];
    evidence?: readonly unknown[];
    reasonCodes?: readonly string[];
    signalQuality?: Record<string, unknown> | null;
    proposedTradePlan?: Record<string, unknown> | null;
    tradePlanEconomics?: Record<string, unknown> | null;
    availability?: string;
    sourceClass?: string;
    certificationRunId?: string | null;
    correlationId?: string | null;
  }[];
  arbitrations: readonly {
    arbitrationId: string;
    signalId: string;
    decision: "ACCEPTED" | "REJECTED" | "SCALED";
    targetQuantity: number;
    conflictStatus: "CLEAR" | "CORRELATED" | "CONFLICT";
    correlationPct: number;
    reasonCode: string;
  }[];
  riskChecks: readonly {
    riskCheckId: string;
    signalId: string;
    status: "PASS" | "WATCH" | "BLOCK";
    limitLabel: string;
    usedPct: number;
    reasonCode: string;
  }[];
  portfolioOrderIntents: readonly LivePortfolioOrderIntent[];
  orders: readonly {
    orderId: string;
    signalId: string;
    providerId: string;
    brokerOrderId: string;
    symbol: string;
    side: "BUY" | "SELL";
    type: "MARKET" | "LIMIT" | "STOP_LIMIT";
    quantity: number;
    state: "INTENT" | "SENT" | "ACKED" | "PARTIAL" | "FILLED" | "CANCELLED" | "REJECTED";
    limitPrice?: number;
    stopPrice?: number;
    targetPrice?: number;
  }[];
  fills: readonly {
    fillId: string;
    orderId: string;
    quantity: number;
    price: number;
    filledAt: string;
  }[];
  positions: readonly {
    positionId: string;
    strategyInstanceId: string;
    symbol: string;
    side: "LONG" | "SHORT" | "FLAT";
    quantity: number;
    averagePrice: number;
    riskR: number;
    pnlR: number;
    protectionStatus: "PROTECTED" | "PENDING" | "UNPROTECTED";
  }[];
  canonicalOrders?: readonly Record<string, unknown>[];
  canonicalFills?: readonly Record<string, unknown>[];
  canonicalPositions?: readonly Record<string, unknown>[];
  legacyHistory?: {
    sourceClass: "LEGACY_HISTORY";
    canonical: false;
    readOnly: true;
    orderIntentCount: number;
    orderCount: number;
    tradeCount: number;
  };
  providers: readonly {
    providerId: string;
    label: string;
    mode: "SHADOW" | "PAPER" | "LIVE";
    status: "OK" | "DEGRADED" | "DOWN";
    latencyMs: number | null;
    lastHeartbeatAt: string;
  }[];
  incidents: readonly {
    incidentId: string;
    severity: "LOW" | "MEDIUM" | "HIGH";
    title: string;
    detail: string;
  }[];
  timeline: readonly {
    eventId: string;
    at: string;
    step: string;
    title: string;
    detail: string;
    tone: "INFO" | "WATCH" | "HIGH";
  }[];
  timeSeriesContracts: {
    schemaVersion: string;
    view: string;
    asOf: string;
    series?: readonly LiveTimeSeriesContract[];
    contracts?: readonly LiveTimeSeriesContract[];
  };
  telegramDrilldown: {
    schemaVersion: string;
    availability: string;
    enabled: boolean;
    healthy: boolean;
    reason?: string;
    lastHeartbeatAt?: string;
    lastDeliveryAt?: string;
    deliveryStatus?: string;
    errorReason?: string;
    secretsExposed: boolean;
    destinations?: readonly {
      label: string;
      configured: boolean;
      lastDeliveryAt: string;
      deliveryStatus: string;
      retryCount: number;
      errorReason: string;
    }[];
  };
  aiAdvisory: {
    mode: "SHADOW" | "ADVISORY" | "OFF";
    lastContextAt: string;
    summary: string;
  };
};

export type LivePortfolioOrderIntent = {
  orderIntentId: string;
  portfolioOrderIntentId: string;
  signalId: string;
  strategyInstanceId: string;
  symbol: string;
  side: "BUY" | "SELL";
  type: string;
  quantity: number;
  state: string;
  limitPrice?: number;
  stopPrice?: number;
  targetPrice?: number;
  account?: string;
  expectedVersion?: string;
  createdAt?: string;
  targetPositionId: string;
  executionTerms: Record<string, unknown> | null;
  riskSnapshot: Record<string, unknown> | null;
  immutability: Record<string, unknown> | null;
  humanGate: {
    gateId: string | null;
    status: string;
    allowedActions: readonly {
      action: "CONFIRM" | "REJECT";
      actionId: string;
      label: string;
      commandType: string;
      environment: "MOCK" | "SHADOW" | "PAPER" | "LIVE";
      permission: "ALLOWED" | "STEP_UP_REQUIRED" | "DENIED";
      requiresConfirmation: boolean;
      requiresReason: boolean;
      expectedRevision: string;
      impactPreview: string;
      payload: Readonly<Record<string, string | number | boolean>>;
    }[];
  };
  allowedActions: {
    resourceType: string;
    allowedActions: readonly string[];
    denialReasons: readonly string[];
    revision: string;
    requiresStepUp: boolean;
    reasonRequired: boolean;
    expiresAt: string | null;
  };
  providerCommandCount: number;
  providerEventCount: number;
  brokerSubmissionAllowed: boolean;
  physicalExecutionState: string;
  ackIsFill: false;
  route: string;
};

export type LiveRiskCenter = {
  schemaVersion: string;
  asOf?: string;
  source?: string;
  availability: string;
  reason?: string;
  globalStatus?: string;
  openRisk?: LiveAvailableMetric;
  limits?: readonly Record<string, unknown>[];
  breaches?: readonly Record<string, unknown>[];
  nearestLimits?: readonly Record<string, unknown>[];
  dailyLoss?: LiveAvailableMetric;
  trailingDrawdown?: LiveAvailableMetric;
  margin?: LiveAvailableMetric;
  grossExposure?: LiveAvailableMetric;
  netExposure?: LiveAvailableMetric;
  concentration?: LiveAvailableMetric;
  propConstraints?: LiveAvailableMetric;
  killSwitch?: { availability: string; active: boolean; source: string; reasonCodes: readonly string[] };
  providerCircuitState?: LiveAvailableMetric;
  pendingOrderIntents?: number;
  pendingTargetPositions?: number;
  policyVersions?: readonly string[];
};

export type LiveAvailableMetric = {
  availability: string;
  value?: string | number | null;
  currency?: string;
  reasonCode?: string;
};

export type LiveTimeSeriesContract = {
  seriesId: string;
  label: string;
  schema?: string;
  source: string;
  availability: string;
  reason?: string | null;
  unit: string;
  sampling: string;
  maxPoints: number;
  cursor: string | boolean | null;
};

export type DemoPaperReadinessView = {
  summary: {
    status: "READY" | "BLOCKED";
    finalDecision: "OPEN_DEMO_PAPER_AGENTS_ALLOWED" | "KEEP_AGENTS_CLOSED_OR_SHADOW";
    canOpenAgents: boolean;
    blockersCount: number;
    nextCheckCommand: string;
    checkedAt: string;
    tradingDate: string;
    session: string;
  };
  launchGate: LiveTradingView["launchGate"];
  components: LiveTradingView["launchGate"]["components"];
  actionItems: readonly {
    actionId: string;
    blockerId: string;
    title: string;
    domain: string;
    severity: "BLOCKER";
    evidence: string;
    operatorAction: string;
    command: string | null;
    route: string;
  }[];
  marketData: {
    state: string;
    marketClosed: boolean;
    coreAgeSeconds: number;
    sourceDurable: boolean;
    effectiveMarketDate: string;
    freshnessPolicy: Record<string, unknown> | null;
    coreFeeds: readonly {
      instrument: string;
      timeframe: string;
      latestTimestampUtc: string;
      latestReceivedAtUtc: string;
      classification: string;
      durable: boolean;
      source: string;
      alertId: string;
    }[];
  };
  broker: {
    accountName: string;
    sim101Account: boolean;
    startupState: string;
    loginRequired: boolean;
    connectionReady: boolean;
    addonHeartbeatFresh: boolean;
    addonConnected: boolean;
    commandEnabled: boolean;
    addonStatus: string;
    executionAuthorityMode: string;
    entryOperatorApprovalRequired: boolean | null;
  };
  commands: {
    releaseGate: string;
    tradingGate: string;
    doctor: string;
    tradingViewDoctor: string;
  };
  links: readonly {
    label: string;
    route: string;
    reason: string;
  }[];
};

export type LiveSignalDetailView = {
  summary: {
    signalScore: number;
    timeToExpirySec: number;
    acceptanceProbabilityPct: number;
    targetQuantity: number;
    riskUsedPct: number;
    conflictCount: number;
  };
  identity: {
    signalId: string;
    strategyId: string;
    strategyDefinitionId: string;
    strategyVersionId: string;
    strategyInstanceId: string;
    runtimeBundleId: string;
    sessionId: string;
    correlationId: string;
    featureSnapshotId: string;
    expectedVersion: string;
  };
  signal: {
    symbol: string;
    direction: "LONG" | "SHORT";
    state: "NEW" | "ARBITRATED" | "REJECTED" | "ORDERED" | "FILLED" | "EXPIRED";
    generatedAt: string;
    expiresAt: string;
    confidence: number;
    expectancyR: number;
    rewardRisk: number;
    regime: string;
    entryZoneLow: number;
    entryZoneHigh: number;
    stopPrice: number;
    targetPrice: number;
  };
  predicates: readonly {
    predicateId: string;
    label: string;
    enumCode: string;
    observedValue: string;
    threshold: string;
    status: "PASS" | "WATCH" | "FAIL";
    sourceFeatureId: string;
  }[];
  featureSnapshot: {
    featureSnapshotId: string;
    datasetId: string;
    cutoffAt: string;
    hash: string;
    pointInTime: true;
    freshness: "FRESH" | "WATCH" | "STALE";
    items: readonly {
      featureId: string;
      label: string;
      value: string;
      source: string;
      quality: "OK" | "WATCH" | "MISSING";
    }[];
  };
  context: readonly {
    contextId: string;
    label: string;
    value: string;
    interpretation: string;
    tone: "POSITIVE" | "NEUTRAL" | "NEGATIVE" | "WATCH";
  }[];
  conflicts: readonly {
    conflictId: string;
    kind: "CORRELATION" | "POSITION_OVERLAP" | "RISK_BUDGET" | "SESSION";
    targetId: string;
    label: string;
    severity: "LOW" | "MEDIUM" | "HIGH";
    resolution: "CLEAR" | "SCALED" | "BLOCKED" | "WATCH";
  }[];
  existingPositions: readonly {
    positionId: string;
    strategyInstanceId: string;
    symbol: string;
    side: "LONG" | "SHORT" | "FLAT";
    quantity: number;
    averagePrice: number;
    pnlR: number;
    riskR: number;
  }[];
  arbitration: {
    arbitrationId: string;
    decision: "ACCEPTED" | "REJECTED" | "SCALED";
    targetQuantity: number;
    conflictStatus: "CLEAR" | "CORRELATED" | "CONFLICT";
    correlationPct: number;
    reasonCode: string;
    portfolioRoute: string;
  };
  riskCheck: {
    riskCheckId: string;
    status: "PASS" | "WATCH" | "BLOCK";
    limitLabel: string;
    usedPct: number;
    reasonCode: string;
    maxRiskPct: number;
    netCapital: number;
    targetRiskR: number;
    roundedQuantity: number;
  };
  linkedOrders: readonly {
    orderId: string;
    providerId: string;
    brokerOrderId: string;
    side: "BUY" | "SELL";
    type: "MARKET" | "LIMIT" | "STOP_LIMIT";
    quantity: number;
    state: "INTENT" | "SENT" | "ACKED" | "PARTIAL" | "FILLED" | "CANCELLED" | "REJECTED";
    limitPrice?: number;
    stopPrice?: number;
    targetPrice?: number;
  }[];
  auditTrail: readonly {
    eventId: string;
    at: string;
    domain: "STRATEGY" | "LIVE" | "PORTFOLIO" | "RISK" | "EXECUTION" | "JARVIS";
    lane: "AUTHORITATIVE" | "ADVISORY";
    title: string;
    route: string;
  }[];
  aiAdvisory: {
    mode: "SHADOW" | "ADVISORY" | "OFF";
    lastContextAt: string;
    summary: string;
    authority: "NONE" | "OPERATOR_REVIEW_ONLY";
    recommendation: "TAKE" | "TAKE_REDUCED" | "WAIT" | "REJECT";
  };
  navigation: readonly {
    label: string;
    route: string;
    kind: "STRATEGY" | "PORTFOLIO" | "EVENTS" | "ORDERS" | "RISK";
  }[];
  commandActions: readonly {
    actionId: string;
    label: string;
    commandType: string;
    decision: "TAKE" | "TAKE_REDUCED" | "WAIT" | "REJECT";
    permission: "ALLOWED" | "STEP_UP_REQUIRED" | "DENIED";
    requiresConfirmation: boolean;
    capability: string;
    payload: Record<string, string | number | boolean>;
  }[];
};

export type OrdersView = {
  humanGateReview: {
    summary: {
      pendingCount: number;
      approvedToday: number;
      rejectedToday: number;
      avgDecisionSeconds: number;
    };
    items: readonly {
      orderIntentId: string;
      instrument: string;
      side: string;
      quantity: number;
      authorizedQuantity: number;
      riskPct: number | null;
      status: string;
      expiresAt: string | null;
      ageSeconds: number;
      route: string;
    }[];
    selectedOrderIntentId: string;
    selectedDossier: {
      lineage: {
        strategyDefinition: { id: string };
        strategyVersion: { id: string };
        strategyInstance: { id: string };
        strategySignal: { id: string };
        contextDecision: { id: string };
        portfolioDecision: { id: string };
        riskDecision: { id: string; decision: string };
        targetPosition: { id: string };
        orderIntent: { id: string };
        humanGate: { id: string; status: string };
        providerCommands: readonly string[];
        providerEvents: readonly string[];
      };
      executionTerms: {
        account_id: string;
        instrument: string;
        side: string;
        quantity: number;
        order_type: string;
        time_in_force: string;
      };
      riskSnapshot: {
        requestedQty: number;
        authorizedQty: number;
        requestedRiskPct: number | null;
        authorizedRiskPct: number | null;
        riskAmount: number | null;
        riskPerContract: number | null;
        nearestLimit: unknown;
        reasonCodes: readonly string[];
      };
    } | null;
    reasonCodes: readonly { code: string; count: number }[];
    pendingByStrategy: readonly { strategyInstanceId: string; pending: number; oldestAgeSeconds: number }[];
    recentDecisions: readonly {
      orderIntentId: string;
      instrument: string;
      decision: "APPROVED" | "REJECTED";
      at: string;
      decisionSeconds: number;
    }[];
  };
  summary: {
    orderIntents: number;
    activeOrders: number;
    recentFills: number;
    partialOrders: number;
    rejectedOrders: number;
    protectedOrdersPct: number;
  };
  filters: {
    activeTab: "INTENTS" | "ACTIVE" | "FILLS" | "PARTIALS" | "CANCELLED" | "REJECTED" | "HISTORY";
    stateCounts: Record<string, number>;
    providerCounts: Record<string, number>;
  };
  orderIntents: readonly {
    orderIntentId: string;
    signalId: string;
    orderId?: string;
    strategyInstanceId: string;
    account: string;
    instrument: string;
    side: "BUY" | "SELL";
    quantity: number;
    type: "MARKET" | "LIMIT" | "STOP_LIMIT";
    tif: "DAY" | "GTC" | "IOC";
    limitPrice?: number;
    stopPrice?: number;
    targetPrice?: number;
    providerId: string;
    state: "CREATED" | "SUBMITTED" | "ACKED" | "PARTIAL" | "FILLED" | "CANCELLED" | "REJECTED";
    idempotencyKey: string;
    correlationId: string;
    createdAt: string;
    expectedVersion: string;
  }[];
  activeOrders: readonly {
    orderId: string;
    orderIntentId: string;
    signalId: string;
    providerId: string;
    brokerOrderId: string;
    strategyInstanceId: string;
    account: string;
    instrument: string;
    side: "BUY" | "SELL";
    quantity: number;
    remainingQuantity: number;
    type: "MARKET" | "LIMIT" | "STOP_LIMIT";
    tif: "DAY" | "GTC" | "IOC";
    state: "INTENT" | "SENT" | "ACKED" | "PARTIAL" | "FILLED" | "CANCELLED" | "REJECTED";
    limitPrice?: number;
    stopPrice?: number;
    targetPrice?: number;
    avgFillPrice?: number;
    commissions: number;
    slippageR: number;
    protectionStatus: "PROTECTED" | "PENDING" | "UNPROTECTED";
    idempotencyKey: string;
    correlationId: string;
    updatedAt: string;
    expectedVersion: string;
  }[];
  fills: readonly {
    fillId: string;
    orderId: string;
    providerId: string;
    brokerExecutionId: string;
    instrument: string;
    quantity: number;
    price: number;
    commission: number;
    slippageR: number;
    filledAt: string;
  }[];
  protections: readonly {
    protectionId: string;
    orderId: string;
    stopOrderId?: string;
    targetOrderId?: string;
    state: "ATTACHED" | "PENDING" | "FAILED";
    stopPrice?: number;
    targetPrice?: number;
    trailingModel: string;
    reasonCode: string;
  }[];
  providers: readonly {
    providerId: string;
    label: string;
    mode: "SHADOW" | "PAPER" | "LIVE";
    status: "OK" | "DEGRADED" | "DOWN";
    activeOrders: number;
    lastAckLatencyMs: number;
    lastHeartbeatAt: string;
  }[];
  stateMachine: readonly {
    state: string;
    count: number;
    description: string;
    tone: "OK" | "WATCH" | "BLOCK";
  }[];
  history: readonly {
    eventId: string;
    at: string;
    orderId?: string;
    title: string;
    detail: string;
    route: string;
    correlationId: string;
  }[];
  commandActions: readonly {
    actionId: string;
    label: string;
    commandType: string;
    targetOrderId?: string;
    targetProviderId?: string;
    permission: "ALLOWED" | "STEP_UP_REQUIRED" | "DENIED";
    requiresConfirmation: boolean;
    criticality: "LOW" | "MEDIUM" | "HIGH";
    expectedVersion: string;
    payload: Record<string, string | number | boolean>;
  }[];
};

export type RiskView = {
  summary: {
    globalStatus: "PASS" | "WATCH" | "BREACH" | "KILL_SWITCH_READY";
    riskUsedPct: number;
    dailyLossR: number;
    dailyLossLimitR: number;
    maxDrawdownR: number;
    trailingDrawdownR: number;
    grossExposureUsd: number;
    netExposureUsd: number;
    leverage: number;
    activeBreaches: number;
    stressTestsToday: number;
    openRiskUsd: number;
  };
  limits: readonly {
    limitId: string;
    scope: "GLOBAL" | "STRATEGY" | "ACCOUNT" | "INSTRUMENT" | "ASSET_CLASS" | "PROP_FIRM";
    label: string;
    targetId: string;
    limitValue: number;
    usedValue: number;
    unit: "PCT" | "USD" | "R" | "LOTS" | "X" | "CONTRACTS";
    usedPct: number;
    headroomValue: number;
    status: "PASS" | "WATCH" | "BREACH" | "BLOCKED";
    reasonCodes: readonly string[];
    lastChangedAt: string;
    changedBy: string;
    officialSource: string;
    contributors: readonly {
      contributorId: string;
      label: string;
      contributionValue: number;
      contributionPct: number;
      route: string;
    }[];
  }[];
  exposures: readonly {
    exposureId: string;
    assetClass: "INDEX" | "RATES" | "FX" | "ENERGY" | "METALS" | "EQUITY";
    grossUsd: number;
    netUsd: number;
    longUsd: number;
    shortUsd: number;
    usedPct: number;
    status: "PASS" | "WATCH" | "BREACH";
    topInstrument: string;
  }[];
  correlations: readonly {
    correlationId: string;
    pair: string;
    value: number;
    limit: number;
    status: "PASS" | "WATCH" | "BREACH";
    reasonCode: string;
    contributors: readonly string[];
  }[];
  propConstraints: readonly {
    constraintId: string;
    label: string;
    rule: string;
    usedValue: number;
    limitValue: number;
    unit: "USD" | "R" | "PCT" | "LOTS";
    status: "PASS" | "WATCH" | "BREACH";
    provider: string;
    nextResetAt: string;
  }[];
  stressTests: readonly {
    stressTestId: string;
    scenario: string;
    state: "QUEUED" | "RUNNING" | "PASSED" | "FAILED";
    lossR: number;
    lossUsd: number;
    marginUsedPct: number;
    tailRiskPct: number;
    completedAt?: string;
    route: string;
  }[];
  breaches: readonly {
    breachId: string;
    limitId: string;
    severity: "LOW" | "MEDIUM" | "HIGH" | "EMERGENCY";
    status: "OPEN" | "ACKED" | "MITIGATED";
    title: string;
    detail: string;
    openedAt: string;
    acknowledgedBy?: string;
    route: string;
    correlationId: string;
  }[];
  commandActions: readonly {
    actionId: string;
    label: string;
    commandType: string;
    permission: "ALLOWED" | "STEP_UP_REQUIRED" | "DENIED";
    requiresConfirmation: boolean;
    criticality: "LOW" | "MEDIUM" | "HIGH" | "EMERGENCY";
    expectedVersion: string;
    impactSummary: string;
    payload: Record<string, string | number | boolean>;
  }[];
  riskByAccount: readonly {
    accountId: string;
    label: string;
    equityUsd: number | null;
    openRiskUsd: number;
    status: string;
  }[];
  riskByStrategy: readonly {
    strategyInstanceId: string;
    label: string;
    riskAmount: number;
    decisions: number;
  }[];
  riskByInstrument: readonly {
    instrument: string;
    riskAmount: number;
    decisions: number;
  }[];
  riskDecisions: {
    summary: { total: number; approved: number; reduced: number; rejected: number; today: number };
    items: readonly {
      at: string;
      orderIntentId: string;
      signalId: string;
      strategyInstanceId: string;
      accountId: string;
      instrument: string;
      requestedQty: number;
      authorizedQty: number;
      riskAmount: number;
      verdict: "APPROVED" | "REDUCED" | "REJECTED";
      reason: string;
    }[];
  };
  circuitBreakers: readonly {
    breakerId: string;
    label: string;
    armed: boolean;
    detail: string;
  }[];
};

export type ExecutionProviderState =
  | "NOT_CONFIGURED"
  | "VALIDATION_PENDING"
  | "DEMO"
  | "SHADOW"
  | "ACTIVE"
  | "STANDBY"
  | "DEGRADED"
  | "DISCONNECTED"
  | "DISABLED";

export type ExecutionProvidersView = {
  summary: {
    primaryProviderId: string;
    standbyProviderId: string;
    activeProviders: number;
    degradedProviders: number;
    disconnectedProviders: number;
    accounts: number;
    avgLatencyMs: number;
    fillRatePct: number;
    slippageR: number;
    openIncidents: number;
  };
  providers: readonly {
    providerId: string;
    label: string;
    adapter: "NINJATRADER" | "PICKMYTRADE" | "SIMULATED" | "BROKER_API";
    role: "PRIMARY" | "STANDBY" | "DEMO" | "SHADOW" | "DISABLED";
    state: ExecutionProviderState;
    accountIds: readonly string[];
    heartbeatAt: string;
    latencyMs: number;
    fillRatePct: number;
    slippageR: number;
    lastReconciliationAt: string;
    sessionHealth: "OK" | "WATCH" | "BLOCK";
    connectivity: "CONNECTED" | "DEGRADED" | "DISCONNECTED";
    browserExposure: "NONE";
    expectedVersion: string;
    capabilities: readonly string[];
  }[];
  accounts: readonly {
    accountId: string;
    providerId: string;
    label: string;
    mode: "PAPER" | "DEMO" | "SHADOW" | "LIVE";
    state: "AVAILABLE" | "LOCKED" | "RECONCILING" | "DISABLED";
    netLiqUsd: number;
    buyingPowerUsd: number;
    openPositions: number;
    ordersToday: number;
    lastPositionCheckAt: string;
  }[];
  adapters: readonly {
    adapterId: string;
    label: string;
    providerId: string;
    version: string;
    installed: boolean;
    availableStates: readonly ExecutionProviderState[];
    capabilityCount: number;
    lastValidatedAt?: string;
  }[];
  healthChecks: readonly {
    checkId: string;
    providerId: string;
    label: string;
    status: "PASS" | "WATCH" | "FAIL";
    latencyMs: number;
    detail: string;
    checkedAt: string;
  }[];
  switchWorkflow: readonly {
    stepId: string;
    label: string;
    state: "PENDING" | "READY" | "RUNNING" | "DONE" | "BLOCKED";
    detail: string;
    order: number;
  }[];
  events: readonly {
    eventId: string;
    providerId: string;
    at: string;
    title: string;
    eventType: string;
    status: "RECEIVED" | "EXPECTED" | "STALE" | "BLOCKED";
    correlationId: string;
    route: string;
  }[];
  incidents: readonly {
    incidentId: string;
    providerId: string;
    severity: "LOW" | "MEDIUM" | "HIGH";
    title: string;
    detail: string;
    route: string;
  }[];
  commandActions: readonly {
    actionId: string;
    label: string;
    commandType: string;
    providerId: string;
    permission: "ALLOWED" | "STEP_UP_REQUIRED" | "DENIED";
    requiresConfirmation: boolean;
    criticality: "LOW" | "MEDIUM" | "HIGH";
    expectedVersion: string;
    simulationOnly: boolean;
    impactSummary: string;
    payload: Record<string, string | number | boolean>;
  }[];
  executionModes: {
    current: string;
    executionEnabled: boolean;
    manualTelegramExecutionEnabled: boolean;
    entryOperatorApprovalRequired: boolean;
    liveAccountAllowed: boolean;
  };
  circuitBreakers: readonly { breakerId: string; label: string; armed: boolean; detail: string }[];
  providerCommands: {
    counts: { all: number; working: number; pending: number; filled: number; partial: number; rejected: number; cancelled: number };
    items: readonly {
      commandId: string;
      orderIntentId: string;
      providerId: string;
      instrument: string;
      side: string;
      quantity: number;
      commandType: string;
      status: string;
      at: string;
    }[];
  };
  fills: readonly ProviderEventRow[];
  partialFills: readonly ProviderEventRow[];
  rejectsAndCancels: readonly ProviderEventRow[];
};

type ProviderEventRow = {
  eventId: string;
  commandId: string;
  orderIntentId: string;
  eventType: string;
  status: string;
  side: string | null;
  quantity: number | null;
  fillQuantity: number | null;
  fillPrice: number | null;
  at: string;
  classification: "FILL" | "PARTIAL_FILL" | "REJECT_CANCEL" | "OTHER";
};

export type ExecutionIncidentSeverity = "LOW" | "MEDIUM" | "HIGH" | "CRITICAL";
export type ExecutionIncidentStatus = "OPEN" | "ACKNOWLEDGED" | "RECONCILING" | "RETRYING" | "RESOLVED" | "ESCALATED" | "DLQ";
export type ExecutionIncidentDomain = "LIVE" | "ORDER" | "POSITION" | "RISK" | "PROVIDER" | "STRATEGY" | "SYSTEM";

export type ExecutionIncidentsView = {
  summary: {
    openIncidents: number;
    criticalIncidents: number;
    highIncidents: number;
    pendingReconciliations: number;
    retryableIncidents: number;
    avgAgeMinutes: number;
    impactedOrders: number;
    impactR: number;
  };
  filters: {
    activeSeverity: "ALL" | ExecutionIncidentSeverity;
    activeDomain: "ALL" | ExecutionIncidentDomain;
    providerIds: readonly string[];
    statuses: readonly ExecutionIncidentStatus[];
    searchHint: string;
  };
  incidents: readonly {
    incidentId: string;
    title: string;
    severity: ExecutionIncidentSeverity;
    domain: ExecutionIncidentDomain;
    status: ExecutionIncidentStatus;
    providerId?: string;
    orderId?: string;
    positionId?: string;
    strategyInstanceId?: string;
    impactR: number;
    impactSummary: string;
    machineRecommendation: string;
    correlationId: string;
    openedAt: string;
    updatedAt: string;
    route: string;
    retryCount: number;
    nextRetryAt?: string;
    operatorGate: "NONE" | "OPTIONAL" | "REQUIRED" | "EMERGENCY_ONLY";
  }[];
  selectedIncident: {
    incidentId: string;
    payloadPreview: readonly {
      key: string;
      value: string;
    }[];
    meta: readonly {
      label: string;
      value: string;
    }[];
    chronology: readonly {
      stepId: string;
      at: string;
      title: string;
      detail: string;
      state: "DONE" | "WAITING" | "FAILED" | "SKIPPED";
      eventId?: string;
    }[];
    reconciliationResults: readonly {
      resultId: string;
      label: string;
      expected: string;
      actual: string;
      status: "MATCH" | "DELTA" | "MISSING" | "REPAIRED";
    }[];
    postMortem: {
      rootCause: string;
      containment: string;
      permanentFix: string;
      ownerRole: "SYSTEM" | "EXECUTION_ENGINE" | "RISK_ENGINE" | "OPERATOR_GATE";
      dueAt: string;
    };
  };
  retries: readonly {
    retryId: string;
    incidentId: string;
    attempt: number;
    state: "SCHEDULED" | "RUNNING" | "FAILED" | "SUCCEEDED" | "ABANDONED";
    nextRunAt?: string;
    lastErrorCode?: string;
    backoffSeconds: number;
  }[];
  commandActions: readonly {
    actionId: string;
    label: string;
    commandType: string;
    incidentId: string;
    permission: "ALLOWED" | "STEP_UP_REQUIRED" | "DENIED";
    requiresConfirmation: boolean;
    criticality: "LOW" | "MEDIUM" | "HIGH" | "EMERGENCY";
    expectedVersion: string;
    impactSummary: string;
    payload: Record<string, string | number | boolean>;
  }[];
  workers: readonly {
    workerId: string;
    role: string;
    status: "ACTIVE" | "WAITING" | "FAILED";
    currentTask: string;
    lastHeartbeatAt: string;
    leaseExpiresAt: string;
  }[];
  workersSummary: { total: number; active: number; idle: number; failed: number };
  runbooks: readonly {
    runbookId: string;
    title: string;
    triggeredBy: string;
    status: string;
    severity: "LOW" | "MEDIUM" | "HIGH";
    updatedAt: string;
  }[];
};

export type AuthSessionView = {
  summary: {
    authenticated: boolean;
    environment: "PAPER" | "STAGING" | "LIVE";
    sessionState: "ACTIVE" | "EXPIRING" | "REVOKED" | "READ_ONLY";
    minutesToExpiry: number;
    permissionsGranted: number;
    permissionsDenied: number;
    stepUpReady: boolean;
    readOnly: boolean;
  };
  principal: {
    userId: string;
    displayName: string;
    maskedEmail: string;
    identityProvider: "SSO" | "LOCAL_OPERATOR_SESSION" | "OIDC" | "SAML";
    roles: readonly string[];
    desks: readonly string[];
    accountScopes: readonly string[];
    timezone: string;
    lastLoginAt: string;
  };
  environments: readonly {
    environment: "PAPER" | "STAGING" | "LIVE";
    label: string;
    current: boolean;
    tradingEnabled: boolean;
    writeEnabled: boolean;
    riskProfile: string;
    accountIds: readonly string[];
    status: "AVAILABLE" | "READ_ONLY" | "LOCKED";
  }[];
  session: {
    sessionId: string;
    issuedAt: string;
    expiresAt: string;
    refreshAfterAt: string;
    refreshStatus: "READY" | "SCHEDULED" | "REFRESHING" | "BLOCKED";
    deviceLabel: string;
    httpOnlySession: boolean;
    browserMaterialExposure: "NONE";
    legacyStoreImported: false;
    csrfBinding: "BOUND" | "MISSING";
  };
  permissions: readonly {
    capability: string;
    label: string;
    domain: "COMMAND" | "RESEARCH" | "STRATEGY" | "LIVE" | "PORTFOLIO" | "RISK" | "EXECUTION" | "SETTINGS" | "ADMIN";
    decision: "ALLOW" | "DENY" | "READ_ONLY" | "STEP_UP_REQUIRED";
    reason: string;
    requiresStepUp: boolean;
  }[];
  routeGuards: readonly {
    route: string;
    capability: string;
    decision: "ALLOW" | "DENY" | "READ_ONLY" | "STEP_UP_REQUIRED";
    reason: string;
  }[];
  stepUp: {
    ready: boolean;
    requiredFor: readonly string[];
    methods: readonly {
      methodId: string;
      label: string;
      state: "AVAILABLE" | "DEGRADED" | "UNAVAILABLE";
      lastVerifiedAt?: string;
    }[];
  };
  events: readonly {
    eventId: string;
    at: string;
    title: string;
    eventType: string;
    status: "OK" | "WATCH" | "BLOCKED";
    correlationId: string;
  }[];
  commandActions: readonly {
    actionId: string;
    label: string;
    commandType: string;
    permission: "ALLOWED" | "STEP_UP_REQUIRED" | "DENIED";
    requiresConfirmation: boolean;
    criticality: "LOW" | "MEDIUM" | "HIGH";
    expectedVersion: string;
    impactSummary: string;
    payload: Record<string, string | number | boolean>;
  }[];
};

export type OperatorSettingsView = {
  summary: {
    theme: "DARK" | "LIGHT" | "SYSTEM";
    density: "COMPACT" | "COMFORT";
    language: "fr-FR" | "en-US";
    timezone: string;
    notificationsEnabled: boolean;
    voiceState: "AVAILABLE" | "DEGRADED" | "DISABLED";
    activeDevices: number;
    activeSessions: number;
    privacyMode: "STANDARD" | "STRICT";
  };
  cockpitPreferences: readonly {
    preferenceId: string;
    label: string;
    category: "THEME" | "DENSITY" | "DASHBOARD" | "FORMAT" | "NAVIGATION";
    value: string;
    allowedValues: readonly string[];
    optimisticAllowed: boolean;
    critical: false;
  }[];
  widgets: readonly {
    widgetId: string;
    label: string;
    area: "COMMAND" | "LIVE" | "RESEARCH" | "EXECUTION" | "RISK";
    visible: boolean;
    order: number;
    refreshSeconds: number;
  }[];
  notificationRules: readonly {
    ruleId: string;
    channel: "DESKTOP" | "TELEGRAM" | "EMAIL" | "SOUND";
    label: string;
    enabled: boolean;
    severity: "INFO" | "WARNING" | "CRITICAL";
    quietHours?: string;
  }[];
  jarvis: {
    voiceState: "AVAILABLE" | "DEGRADED" | "DISABLED";
    pushToTalkEnabled: boolean;
    wakeWordEnabled: boolean;
    transcriptRetention: "SESSION_ONLY" | "TWENTY_FOUR_HOURS" | "DISABLED";
    lastVoiceCheckAt: string;
  };
  shortcuts: readonly {
    shortcutId: string;
    label: string;
    keys: string;
    route: string;
    enabled: boolean;
  }[];
  devices: readonly {
    deviceId: string;
    label: string;
    kind: "VPS" | "DESKTOP" | "MOBILE" | "BROWSER";
    trusted: boolean;
    lastSeenAt: string;
    sessionId?: string;
    state: "ACTIVE" | "STALE" | "REVOKABLE";
  }[];
  privacy: readonly {
    policyId: string;
    label: string;
    value: string;
    editable: boolean;
    reason: string;
  }[];
  guardrails: readonly {
    guardrailId: string;
    label: string;
    status: "PASS" | "WATCH" | "BLOCK";
    detail: string;
  }[];
  commandActions: readonly {
    actionId: string;
    label: string;
    commandType: string;
    permission: "ALLOWED" | "STEP_UP_REQUIRED" | "DENIED";
    requiresConfirmation: boolean;
    criticality: "LOW" | "MEDIUM" | "HIGH";
    expectedVersion: string;
    impactSummary: string;
    optimisticAllowed: boolean;
    payload: Record<string, string | number | boolean>;
  }[];
};

export type AdminAccessView = {
  summary: {
    accessMode: "FULL_ADMIN" | "READ_ONLY" | "DENIED";
    users: number;
    activeUsers: number;
    roles: number;
    capabilities: number;
    accountGroups: number;
    pendingChanges: number;
    auditEvents: number;
  };
  currentAccess: {
    userId: string;
    roles: readonly string[];
    canMutate: boolean;
    readOnlyReason?: string;
    stepUpReady: boolean;
  };
  users: readonly {
    userId: string;
    displayName: string;
    maskedEmail: string;
    roles: readonly string[];
    status: "ACTIVE" | "INVITED" | "LOCKED" | "REVOKED";
    mfaState: "READY" | "REQUIRED" | "LOCKED";
    accountGroupIds: readonly string[];
    lastSeenAt?: string;
  }[];
  roles: readonly {
    roleId: string;
    label: string;
    description: string;
    userCount: number;
    capabilityCount: number;
    riskLevel: "LOW" | "MEDIUM" | "HIGH";
    stepUpRequired: boolean;
  }[];
  capabilities: readonly {
    capability: string;
    domain: "AUTH" | "SETTINGS" | "RESEARCH" | "LIVE" | "PORTFOLIO" | "RISK" | "EXECUTION" | "ADMIN";
    decision: "ALLOW" | "DENY" | "READ_ONLY" | "STEP_UP_REQUIRED";
    sourceRole: string;
    reason: string;
  }[];
  accountGroups: readonly {
    groupId: string;
    label: string;
    environment: "PAPER" | "STAGING" | "LIVE";
    accountIds: readonly string[];
    providerIds: readonly string[];
    status: "ACTIVE" | "READ_ONLY" | "LOCKED";
  }[];
  policies: readonly {
    policyId: string;
    label: string;
    confirmationMode: "SINGLE" | "DOUBLE_VALIDATION" | "STEP_UP";
    enabled: boolean;
    scope: string;
    status: "PASS" | "WATCH" | "BLOCK";
  }[];
  providerAccess: readonly {
    providerId: string;
    label: string;
    access: "READ" | "COMMAND" | "DENIED";
    environment: "PAPER" | "STAGING" | "LIVE";
    browserMaterialExposure: "NONE";
    status: "PASS" | "WATCH" | "BLOCK";
  }[];
  auditEvents: readonly {
    auditId: string;
    at: string;
    actorUserId: string;
    action: string;
    target: string;
    status: "ACCEPTED" | "DENIED" | "APPLIED" | "FAILED";
    commandId?: string;
    correlationId: string;
  }[];
  commandActions: readonly {
    actionId: string;
    label: string;
    commandType: string;
    permission: "ALLOWED" | "STEP_UP_REQUIRED" | "DENIED";
    requiresConfirmation: boolean;
    criticality: "LOW" | "MEDIUM" | "HIGH";
    expectedVersion: string;
    impactSummary: string;
    payload: Record<string, string | number | boolean>;
  }[];
};

export type ResearchAgentName =
  | "Hypothesis Agent"
  | "Experiment Agent"
  | "Strategy Builder"
  | "Quantitative Validator"
  | "Robustness Auditor"
  | "OOS Validator"
  | "Research Reviewer"
  | "Data Scout"
  | "Knowledge Curator";

export type ResearchLabView = {
  summary: {
    runningExperiments: number;
    completedExperiments: number;
    promotedStrategies: number;
    rejectedStrategies: number;
    activeResearchAgents: number;
    computeBudgetUsedPct: number;
    tokenBudgetUsedPct: number;
  };
  pipeline: readonly {
    stageId: "IDEA" | "BASELINE" | "ITERATION" | "ROBUSTNESS" | "OOS" | "PAPER_READY";
    label: string;
    state: "DONE" | "RUNNING" | "WAITING" | "BLOCKED";
    activeExperiments: number;
    promoted: number;
    rejected: number;
    budgetUsedPct: number;
  }[];
  experiments: readonly {
    experimentId: string;
    missionId: string;
    runId: string;
    title: string;
    hypothesis: string;
    ownerAgent: ResearchAgentName;
    stage: "IDEA" | "BASELINE" | "ITERATION" | "ROBUSTNESS" | "OOS" | "PAPER_READY";
    status: "RUNNING" | "PASSED" | "FAILED" | "PROMOTED" | "REJECTED" | "WAITING";
    progressPct: number;
    score: number;
    eta: string;
    currentTask: string;
    expectedEvent: string;
    tokenBudgetPct: number;
    computeBudgetPct: number;
  }[];
  agents: readonly {
    agentId: string;
    taskId: string;
    name: string;
    role: string;
    status: "ACTIVE" | "IDLE" | "WAITING" | "BLOCKED";
    missionId: string;
    missionKey: string;
    task: string;
    model: string;
    reasoningLevel: "low" | "medium" | "high" | "ultra";
    queueDepth: number;
    tokenBudgetPct: number;
    leaseActive: boolean;
    leaseExpiresAt: string;
    lastHeartbeatAt: string;
  }[];
  coverage: readonly {
    coverageId: string;
    label: string;
    coveragePct: number;
    detail: string;
    quality: "OK" | "WATCH" | "GAP";
  }[];
  results: readonly {
    resultId: string;
    experimentId: string;
    strategyId: string;
    title: string;
    decision: "PROMOTED" | "REJECTED" | "REVIEW";
    oosR: number;
    sharpe: number;
    robustnessScore: number;
    compositeScore: number;
    decidedAt: string;
  }[];
  knowledgeGraph: {
    clusters: readonly {
      clusterId: string;
      label: string;
      experiments: number;
      similarityPct: number;
      signal: "EDGE" | "DUPLICATE_RISK" | "NOVEL";
    }[];
    strongestLink: string;
    noveltyScore: number;
  };
  computeQueue: readonly {
    jobId: string;
    missionId: string;
    label: string;
    status: "QUEUED" | "RUNNING" | "DONE" | "FAILED";
    progressPct: number;
    worker: string;
    eta: string;
    costUsd: number;
  }[];
  datasets: readonly {
    datasetId: string;
    label: string;
    lineage: string;
    coverage: string;
    pointInTime: boolean;
    quality: "OK" | "WATCH" | "GAP";
  }[];
  incidents: readonly {
    incidentId: string;
    severity: "LOW" | "MEDIUM" | "HIGH";
    title: string;
    detail: string;
    openedAt: string;
  }[];
  activityStream: readonly {
    eventId: string;
    eventType: string;
    missionKey: string;
    taskKey: string;
    detail: string;
    at: string;
  }[];
  commandActions: readonly {
    actionId: string;
    label: string;
    commandType: string;
    permission: "ALLOWED" | "STEP_UP_REQUIRED" | "DENIED";
    requiresConfirmation: boolean;
    impactSummary: string;
    payload: Record<string, unknown>;
  }[];
};

export type StrategyCenterView = {
  summary: {
    totalStrategies: number;
    liveStrategies: number;
    paperStrategies: number;
    watchlistStrategies: number;
    suspendedStrategies: number;
    averageProfitFactor: number;
    averageDrawdownR: number;
    averageExpectancyR: number;
  };
  strategies: readonly {
    strategyId: string;
    strategyDefinitionId: string;
    strategyVersionId: string;
    strategyInstanceId: string;
    runtimeBundleId: string;
    name: string;
    family: "Breakout" | "Mean Reversion" | "Macro" | "Momentum" | "Arbitrage";
    instruments: readonly string[];
    timeframe: string;
    scientificStatus: "CANDIDATE" | "VALIDATED" | "REJECTED" | "WATCHLIST";
    versionStatus: "DRAFT" | "VALIDATED" | "REJECTED" | "DEPRECATED" | "RETIRED";
    runtimeStatus: "STOPPED" | "STARTING" | "RUNNING" | "PAUSED" | "FAILED";
    executionMode: "SHADOW" | "PAPER" | "LIVE";
    tier: "TIER_1" | "TIER_2" | "TIER_3" | "WATCH";
    expectancyR: number;
    profitFactor: number;
    winRatePct: number;
    maxDrawdownR: number;
    liveHealth: "OK" | "WATCH" | "DEGRADED" | "OFF";
    lifecycle: "DRAFT" | "RESEARCH" | "SHADOW" | "PAPER" | "LIVE";
    lastOosR: number;
  }[];
  lifecycleDistribution: readonly {
    label: string;
    count: number;
    pct: number;
  }[];
  performanceByFamily: readonly {
    family: string;
    strategies: number;
    averageProfitFactor: number;
    expectancyR: number;
    drawdownR: number;
  }[];
  topStrategies: readonly {
    strategyId: string;
    name: string;
    score: number;
    oosR: number;
    liveParityPct: number;
  }[];
  recentEvents: readonly {
    eventId: string;
    at: string;
    title: string;
    detail: string;
    tone: "INFO" | "WATCH" | "HIGH";
  }[];
  selectedInspector: {
    strategyId: string;
    strategyDefinitionId: string;
    strategyVersionId: string;
    strategyInstanceId: string;
    runtimeBundleId: string;
    thesis: string;
    rulesSummary: readonly string[];
    meta: {
      instruments: readonly string[];
      timeframe: string;
      sessionScope: readonly string[];
      owner: string;
      publishedAt: string;
      compiledArtifactHash: string;
      executionMode: "SHADOW" | "PAPER" | "LIVE";
      accountScope: string;
    };
    spec: {
      entryModel: string;
      stopModel: string;
      targetModel: string;
      invalidationModel: string;
      riskModel: string;
      rules: readonly { ruleId: string; label: string; type: string; expression: string; state: string; weightPct: number }[];
      levels: readonly { levelId: string; label: string; lower: number; upper: number; role: string }[];
    };
    gates: readonly {
      label: string;
      state: "PASS" | "WATCH" | "FAIL" | "PENDING";
      detail: string;
    }[];
    lineage: readonly {
      nodeType: "HYPOTHESIS" | "EXPERIMENT" | "RUN" | "CANDIDATE" | "STRATEGY_VERSION" | "INSTANCE";
      id: string;
      at: string;
    }[];
    runtimeInstances: readonly {
      strategyInstanceId: string;
      instruments: readonly string[];
      mode: "SHADOW" | "PAPER" | "LIVE";
      runtimeStatus: "STOPPED" | "STARTING" | "RUNNING" | "PAUSED" | "FAILED";
      health: "OK" | "WATCH" | "DEGRADED" | "OFF";
      lastHeartbeatAt: string;
      signalsToday: number;
    }[];
    performance: {
      availability: "AVAILABLE" | "UNAVAILABLE";
      expectancyR: number;
      profitFactor: number;
      winRatePct: number;
      maxDrawdownR: number;
      oosR: number;
      series: readonly { sequence: number; at: string; cumulativeR: number; drawdownR: number }[];
    };
    riskAllocationPct: number;
    currentCommandEligibility: "CAN_REQUEST_SHADOW" | "CAN_REQUEST_PAPER" | "READ_ONLY";
  };
};

export type StrategyDetailView = {
  summary: {
    strategyScore: number;
    activeVersions: number;
    runningInstances: number;
    riskAllocationPct: number;
    liveParityPct: number;
    openSignals: number;
    trades30d: number;
    netR30d: number;
  };
  identity: {
    strategyId: string;
    strategyDefinitionId: string;
    strategyVersionId: string;
    strategyInstanceId: string;
    runtimeBundleId: string;
    name: string;
    family: "Breakout" | "Mean Reversion" | "Macro" | "Momentum" | "Arbitrage";
    thesis: string;
    scientificStatus: "CANDIDATE" | "VALIDATED" | "REJECTED" | "WATCHLIST";
    versionStatus: "DRAFT" | "VALIDATED" | "REJECTED" | "DEPRECATED" | "RETIRED";
    runtimeStatus: "STOPPED" | "STARTING" | "RUNNING" | "PAUSED" | "FAILED";
    executionMode: "SHADOW" | "PAPER" | "LIVE";
    tier: "TIER_1" | "TIER_2" | "TIER_3" | "WATCH";
    ownerAgent: ResearchAgentName;
  };
  definition: {
    strategySpecId: string;
    dslVersion: string;
    sourceExperimentId: string;
    sourceRunId: string;
    instruments: readonly string[];
    timeframes: readonly string[];
    sessions: readonly string[];
    tags: readonly string[];
  };
  strategySpec: {
    entryModel: string;
    stopModel: string;
    targetModel: string;
    invalidationModel: string;
    riskModel: string;
    rules: readonly {
      ruleId: string;
      label: string;
      type: "ENTRY" | "FILTER" | "RISK" | "EXIT" | "INVALIDATION";
      expression: string;
      state: "ACTIVE" | "WATCH" | "DISABLED";
      weightPct: number;
    }[];
    levels: readonly {
      levelId: string;
      label: string;
      lower: number;
      upper: number;
      role: "ENTRY_ZONE" | "STOP" | "TARGET" | "INVALIDATION";
    }[];
  };
  constraints: readonly {
    constraintId: string;
    label: string;
    scope: "RISK" | "SESSION" | "CORRELATION" | "DATA" | "EXECUTION";
    status: "PASS" | "WATCH" | "BLOCK";
    value: string;
  }[];
  regimes: readonly {
    regimeId: string;
    label: string;
    status: "FAVOURABLE" | "NEUTRAL" | "AVOID";
    expectancyR: number;
    trades: number;
    note: string;
  }[];
  versions: readonly {
    strategyVersionId: string;
    label: string;
    status: "DRAFT" | "VALIDATED" | "REJECTED" | "DEPRECATED" | "RETIRED";
    createdAt: string;
    sourceRunId: string;
    expectancyR: number;
    maxDrawdownR: number;
    changeSummary: string;
  }[];
  instances: readonly {
    strategyInstanceId: string;
    strategyVersionId: string;
    runtimeBundleId: string;
    mode: "SHADOW" | "PAPER" | "LIVE";
    runtimeStatus: "STOPPED" | "STARTING" | "RUNNING" | "PAUSED" | "FAILED";
    account: string;
    riskAllocationPct: number;
    lastHeartbeatAt: string;
  }[];
  performance: readonly {
    scope: "BACKTEST" | "PAPER" | "LIVE";
    trades: number;
    netR: number;
    expectancyR: number;
    profitFactor: number;
    winRatePct: number;
    maxDrawdownR: number;
    parityPct?: number;
  }[];
  signals: readonly {
    signalId: string;
    strategyInstanceId: string;
    symbol: string;
    direction: "LONG" | "SHORT";
    state: "NEW" | "ARBITRATED" | "REJECTED" | "ORDERED" | "FILLED" | "EXPIRED";
    confidence: number;
    createdAt: string;
    ruleHits: readonly string[];
  }[];
  trades: readonly {
    tradeId: string;
    signalId: string;
    symbol: string;
    side: "LONG" | "SHORT";
    openedAt: string;
    closedAt: string;
    pnlR: number;
    exitReason: string;
  }[];
  incidents: readonly {
    incidentId: string;
    severity: "LOW" | "MEDIUM" | "HIGH";
    status: "OPEN" | "ACKED" | "RESOLVED";
    title: string;
    detail: string;
  }[];
  correlations: readonly {
    target: string;
    correlationPct: number;
    exposureOverlapPct: number;
    status: "CLEAR" | "WATCH" | "BLOCK";
  }[];
  riskAllocation: {
    budgetPct: number;
    usedPct: number;
    maxConcurrentSignals: number;
    netCapitalPct: number;
    reason: string;
  };
  commandActions: readonly {
    actionId: string;
    label: string;
    commandType: string;
    permission: "ALLOWED" | "STEP_UP_REQUIRED" | "DENIED";
    requiresConfirmation: boolean;
    payload: Record<string, string | number | boolean>;
  }[];
};

export type StrategyCompareView = {
  summary: {
    strategyId: string;
    baseVersionId: string;
    candidateVersionId: string;
    verdict: "PROMOTE" | "KEEP_BASE" | "REVIEW";
    netImprovementR: number;
    expectancyDeltaR: number;
    profitFactorDelta: number;
    drawdownDeltaR: number;
    liveParityDeltaPct: number;
  };
  strategy: {
    strategyId: string;
    name: string;
    family: "Breakout" | "Mean Reversion" | "Macro" | "Momentum" | "Arbitrage";
    strategyDefinitionId: string;
  };
  versions: readonly {
    role: "BASE" | "CANDIDATE";
    strategyVersionId: string;
    runtimeBundleId: string;
    label: string;
    status: "DRAFT" | "VALIDATED" | "REJECTED" | "DEPRECATED" | "RETIRED";
    sourceRunId: string;
    createdAt: string;
  }[];
  specDiffs: readonly {
    diffId: string;
    section: "ENTRY" | "RISK" | "EXIT" | "FILTER" | "INVALIDATION";
    field: string;
    before: string;
    after: string;
    impact: "POSITIVE" | "NEGATIVE" | "NEUTRAL";
  }[];
  parameterDiffs: readonly {
    param: string;
    before: string | number | boolean;
    after: string | number | boolean;
    changeType: "ADDED" | "REMOVED" | "MODIFIED";
  }[];
  metricComparison: readonly {
    metric: "EXPECTANCY_R" | "PROFIT_FACTOR" | "MAX_DD_R" | "WIN_RATE_PCT" | "FREQUENCY";
    base: number;
    candidate: number;
    delta: number;
    verdict: "BETTER" | "WORSE" | "FLAT";
  }[];
  regimeComparison: readonly {
    regimeId: string;
    label: string;
    baseR: number;
    candidateR: number;
    deltaR: number;
    verdict: "BETTER" | "WORSE" | "FLAT";
  }[];
  divergentTrades: readonly {
    tradeId: string;
    at: string;
    symbol: string;
    baseDecision: string;
    candidateDecision: string;
    deltaR: number;
    reason: string;
  }[];
  costs: readonly {
    scope: "BACKTEST" | "PAPER" | "LIVE";
    baseCostR: number;
    candidateCostR: number;
    slippageDeltaR: number;
    verdict: "BETTER" | "WORSE" | "FLAT";
  }[];
  parity: readonly {
    scope: "BACKTEST_VS_PAPER" | "BACKTEST_VS_LIVE";
    basePct: number;
    candidatePct: number;
    deltaPct: number;
    status: "PASS" | "WATCH" | "BLOCK";
  }[];
  deepLinks: readonly {
    label: string;
    route: string;
    kind: "RUN" | "STRATEGY" | "EXPERIMENT";
  }[];
  commandActions: readonly {
    actionId: string;
    label: string;
    commandType: string;
    permission: "ALLOWED" | "STEP_UP_REQUIRED" | "DENIED";
    requiresConfirmation: boolean;
    payload: Record<string, string | number | boolean>;
  }[];
};

export type JarvisWorkspaceView = {
  summary: {
    morningBriefStatus: "READY" | "STALE" | "MISSING";
    openSuggestions: number;
    pendingActions: number;
    activeAgents: number;
    voiceStatus: "READY" | "DEGRADED" | "OFF";
    freshnessSeconds: number;
  };
  missions: readonly {
    missionId: string;
    title: string;
    ownerAgent: string;
    state: "WAITING" | "RUNNING" | "NEEDS_OPERATOR" | "DONE";
  }[];
  morningBrief: readonly {
    sectionId: string;
    domain: "Research" | "Strategies" | "Live" | "Risk" | "Execution" | "Incidents";
    status: "OK" | "WATCH" | "HIGH";
    headline: string;
    detail: string;
    sourceIds: readonly string[];
  }[];
  suggestions: readonly {
    suggestionId: string;
    title: string;
    impact: string;
    sourceIds: readonly string[];
    pendingActionId?: string;
  }[];
  conversation: readonly {
    messageId: string;
    role: "operator" | "jarvis" | "system";
    at: string;
    text: string;
    citationIds: readonly string[];
  }[];
  citations: readonly {
    citationId: string;
    label: string;
    route: string;
    freshness: "fresh" | "stale" | "degraded";
  }[];
  deskSnapshot: {
    riskUsedPct: number;
    liveSignals: number;
    researchExperiments: number;
    providersOk: number;
    providersTotal: number;
    openIncidents: number;
  };
  pendingActions: readonly {
    actionId: string;
    title: string;
    impact: string;
    permission: "ALLOWED" | "STEP_UP_REQUIRED" | "DENIED";
    requiresConfirmation: boolean;
    commandType: string;
    payload: Record<string, string | number | boolean>;
  }[];
  alerts: readonly {
    alertId: string;
    severity: "LOW" | "MEDIUM" | "HIGH";
    title: string;
    route: string;
  }[];
  voice: {
    pushToTalkAvailable: boolean;
    serviceStatus: "READY" | "DEGRADED" | "OFF";
    degradationReason?: string;
    lastTranscript?: string;
  };
  commands: readonly {
    commandId: string;
    status: "ACCEPTED" | "RUNNING" | "SUCCEEDED" | "FAILED" | "REJECTED";
    title: string;
  }[];
};

export type OperationsQueueView = {
  summary: {
    activeMissions: number;
    waitingEvents: number;
    blockedGates: number;
    retryBacklog: number;
    dlqItems: number;
    budgetUsedPct: number;
  };
  missions: readonly {
    missionId: string;
    title: string;
    ownerAgent: string;
    currentTask: string;
    state: "RUNNING" | "WAITING_EVENT" | "OPERATOR_GATE_REQUIRED" | "RETRYING" | "DLQ" | "DONE";
    expectedEvent: string;
    receivedEvent?: string;
    nextTransition: string;
    policyGate: "PASS" | "WATCH" | "BLOCKED" | "OPERATOR_GATE_REQUIRED";
    tokenBudgetPct: number;
    computeBudgetPct: number;
    retryCount: number;
    maxRetries: number;
    correlationId: string;
  }[];
  eventFlow: readonly {
    eventId: string;
    correlationId: string;
    causationId?: string;
    at: string;
    eventType: string;
    domain: "RESEARCH" | "STRATEGY" | "LIVE" | "EXECUTION" | "JARVIS" | "SYSTEM";
    status: "RECEIVED" | "EXPECTED" | "STALE" | "BLOCKED";
    latencyMs: number;
    missionId: string;
  }[];
  policyGates: readonly {
    gateId: string;
    label: string;
    state: "PASS" | "WATCH" | "BLOCKED" | "OPERATOR_GATE_REQUIRED";
    reason: string;
    missionId: string;
  }[];
  deadLetters: readonly {
    dlqId: string;
    missionId: string;
    reason: string;
    retryable: boolean;
    lastErrorCode: string;
    ageMinutes: number;
  }[];
  incidents: readonly {
    incidentId: string;
    severity: "LOW" | "MEDIUM" | "HIGH" | "CRITICAL";
    title: string;
    domain: "RESEARCH" | "STRATEGY" | "LIVE" | "EXECUTION" | "JARVIS" | "SYSTEM";
    missionId: string;
    route: string;
  }[];
  commandActions: readonly {
    actionId: string;
    label: string;
    missionId: string;
    commandType: string;
    permission: "ALLOWED" | "STEP_UP_REQUIRED" | "DENIED";
    requiresConfirmation: boolean;
    payload: Record<string, string | number | boolean>;
  }[];
};

export type EventsAuditView = {
  summary: {
    totalEvents: number;
    correlations: number;
    avgLatencyMs: number;
    authoritativeSteps: number;
    advisoryBranches: number;
    exportablePayloads: number;
  };
  filters: {
    activeCorrelationId: string;
    windowLabel: string;
    domains: readonly ("RESEARCH" | "STRATEGY" | "LIVE" | "PORTFOLIO" | "RISK" | "EXECUTION" | "JARVIS" | "SYSTEM")[];
    statuses: readonly ("OK" | "WATCH" | "FAILED" | "EXPECTED")[];
  };
  events: readonly {
    eventId: string;
    correlationId: string;
    causationId?: string;
    at: string;
    eventType: string;
    domain: "RESEARCH" | "STRATEGY" | "LIVE" | "PORTFOLIO" | "RISK" | "EXECUTION" | "JARVIS" | "SYSTEM";
    lane: "AUTHORITATIVE" | "ADVISORY" | "SYSTEM";
    status: "OK" | "WATCH" | "FAILED" | "EXPECTED";
    latencyMs: number;
    schemaVersion: string;
    route: string;
  }[];
  selectedCorrelation: {
    correlationId: string;
    rootEventId: string;
    totalLatencyMs: number;
    authoritativePath: readonly string[];
    advisoryPath: readonly string[];
    payloadPreview: readonly {
      key: string;
      value: string;
    }[];
    logs: readonly {
      logId: string;
      level: "INFO" | "WARN" | "ERROR";
      message: string;
    }[];
  };
  relations: readonly {
    fromEventId: string;
    toEventId: string;
    relation: "CAUSES" | "FOLLOWS" | "ADVISES" | "BLOCKS";
  }[];
  commandActions: readonly {
    actionId: string;
    label: string;
    commandType: string;
    permission: "ALLOWED" | "STEP_UP_REQUIRED" | "DENIED";
    requiresConfirmation: boolean;
    payload: Record<string, string | number | boolean>;
  }[];
};

export type ResearchExperimentDetailView = {
  experiment: {
    experimentId: string;
    missionId: string;
    runId: string;
    title: string;
    hypothesis: string;
    family: string;
    stage: "IDEA" | "BASELINE" | "ITERATION" | "ROBUSTNESS" | "OOS" | "PAPER_READY";
    status: "RUNNING" | "WAITING" | "PASSED" | "FAILED" | "ARCHIVED" | "CANDIDATE";
    score: number;
    progressPct: number;
    currentTask: string;
    expectedEvent: string;
    nextAutomaticTransition: string;
  };
  ownership: {
    ownerAgentId: string;
    ownerAgentName: string;
    missionId: string;
    conversationId: string;
    leaseId: string;
    heartbeatAt: string;
    tokenBudgetPct: number;
    computeBudgetPct: number;
  };
  datasets: readonly {
    datasetId: string;
    label: string;
    hash: string;
    coverage: string;
    quality: "OK" | "WATCH" | "FAILED";
    pointInTime: boolean;
  }[];
  strategySpec: {
    strategyId: string;
    strategyVersionId: string;
    specId: string;
    instrument: string;
    timeframe: string;
    entryModel: string;
    riskModel: string;
    invariants: readonly string[];
  };
  versions: readonly {
    versionId: string;
    label: string;
    parentVersionId?: string;
    createdAt: string;
    change: string;
    status: "ACTIVE" | "PARENT" | "REJECTED" | "CANDIDATE";
  }[];
  iterations: readonly {
    iterationId: string;
    at: string;
    stage: string;
    result: "PASS" | "WATCH" | "FAIL";
    metricR: number;
    note: string;
  }[];
  segmentedMetrics: readonly {
    segmentId: string;
    label: string;
    trades: number;
    pnlR: number;
    sharpe: number;
    maxDrawdownR: number;
    verdict: "PASS" | "WATCH" | "FAIL";
  }[];
  agentJournal: readonly {
    journalId: string;
    at: string;
    level: "INFO" | "WARN" | "ERROR";
    message: string;
  }[];
  knowledgeCreated: readonly {
    knowledgeId: string;
    title: string;
    kind: "EDGE" | "REGIME" | "ANTI_PATTERN" | "DATA_QUALITY";
    confidencePct: number;
    route: string;
  }[];
  commandActions: readonly {
    actionId: string;
    label: string;
    commandType: string;
    permission: "ALLOWED" | "STEP_UP_REQUIRED" | "DENIED";
    requiresConfirmation: boolean;
    payload: Record<string, string | number | boolean>;
  }[];
};

export type ResearchRunDetailView = {
  run: {
    runId: string;
    experimentId: string;
    missionId: string;
    strategyVersionId: string;
    datasetId: string;
    datasetHash: string;
    engineVersion: string;
    runtimeVersion: string;
    seed: number;
    status: "RUNNING" | "COMPLETED" | "FAILED" | "QUEUED";
    reproducibility: "LOCKED" | "PARTIAL" | "BROKEN";
    startedAt: string;
    completedAt?: string;
  };
  parameters: readonly {
    key: string;
    value: string | number | boolean;
  }[];
  summary: {
    totalR: number;
    maxDrawdownR: number;
    trades: number;
    winRatePct: number;
    profitFactor: number;
    sharpe: number;
    avgMaeR: number;
    avgMfeR: number;
    slippageR: number;
    costR: number;
  };
  equityCurve: readonly number[];
  distribution: readonly {
    bucket: string;
    count: number;
    pnlR: number;
  }[];
  regimePerformance: readonly {
    regimeId: string;
    label: string;
    trades: number;
    pnlR: number;
    sharpe: number;
    verdict: "PASS" | "WATCH" | "FAIL";
  }[];
  hourlyPerformance: readonly {
    hourLabel: string;
    trades: number;
    pnlR: number;
  }[];
  ambiguity: readonly {
    ambiguityId: string;
    barTime: string;
    reason: string;
    resolution: "CONSERVATIVE" | "SKIP" | "ENGINE_RESOLVED";
  }[];
  benchmark: {
    baselineRunId: string;
    deltaR: number;
    deltaDrawdownR: number;
    verdict: "BETTER" | "MIXED" | "WORSE";
  };
  trades: readonly {
    tradeId: string;
    openedAt: string;
    closedAt: string;
    symbol: string;
    side: "LONG" | "SHORT";
    entry: number;
    exit: number;
    pnlR: number;
    maeR: number;
    mfeR: number;
    regime: string;
  }[];
  commandActions: readonly {
    actionId: string;
    label: string;
    commandType: string;
    permission: "ALLOWED" | "STEP_UP_REQUIRED" | "DENIED";
    requiresConfirmation: boolean;
    payload: Record<string, string | number | boolean>;
  }[];
};

export type ResearchAgentFleetView = {
  summary: {
    totalAgents: number;
    activeAgents: number;
    waitingAgents: number;
    lockedLeases: number;
    queueDepth: number;
    avgSuccessRatePct: number;
  };
  agents: readonly {
    agentId: string;
    taskId: string;
    name: string;
    type: "HYPOTHESIS" | "OOS_VALIDATOR" | "ROBUSTNESS_AUDITOR" | "DATA_SCOUT";
    role: string;
    missionId: string;
    conversationId: string;
    runtimeStatus: "ACTIVE" | "WAITING" | "PAUSED" | "FAILED";
    currentTask: string;
    waitingForEvent: string;
    model: string;
    reasoningLevel: "medium" | "high" | "ultra";
    tokenBudgetPct: number;
    computeBudgetPct: number;
    leaseId: string;
    lockState: "LOCKED" | "FREE" | "STALE";
    heartbeatAt: string;
    retryCount: number;
    successRatePct: number;
    queueDepth: number;
  }[];
  queue: readonly {
    queueItemId: string;
    missionId: string;
    agentId: string;
    priority: "LOW" | "NORMAL" | "HIGH";
    expectedEvent: string;
    eta: string;
    state: "READY" | "RUNNING" | "WAITING_EVENT" | "RETRY";
  }[];
  conversations: readonly {
    conversationId: string;
    agentId: string;
    lastMessageAt: string;
    retainedContext: string;
    tokenWindowPct: number;
  }[];
  incidents: readonly {
    incidentId: string;
    agentId: string;
    severity: "LOW" | "MEDIUM" | "HIGH";
    title: string;
    retryable: boolean;
  }[];
  commandActions: readonly {
    actionId: string;
    label: string;
    agentId: string;
    commandType: string;
    permission: "ALLOWED" | "STEP_UP_REQUIRED" | "DENIED";
    requiresConfirmation: boolean;
    payload: Record<string, string | number | boolean>;
  }[];
};

export type ResearchDataCatalogView = {
  summary: {
    datasets: number;
    instruments: number;
    features: number;
    qualityOkPct: number;
    openGaps: number;
    lineageEdges: number;
  };
  datasets: readonly {
    datasetId: string;
    label: string;
    instruments: readonly string[];
    granularity: string;
    period: string;
    source: string;
    provenance: string;
    quality: "OK" | "WATCH" | "DEGRADED";
    freshness: string;
    pointInTime: boolean;
    lookaheadStatus: "PASS" | "WATCH" | "FAIL";
    version: string;
    gaps: number;
    timezone: string;
    rolloverPolicy: string;
  }[];
  instruments: readonly {
    symbol: string;
    assetClass: "FUTURES" | "FX" | "RATES" | "MACRO" | "EQUITY";
    primaryDatasetId: string;
    sessionTemplate: string;
    timezone: string;
    rollover: string;
    nextRollover: string;
    coveragePct: number;
    quality: "OK" | "WATCH" | "DEGRADED";
  }[];
  features: readonly {
    featureId: string;
    label: string;
    family: "PRICE" | "CROSS_ASSET" | "MACRO" | "EXECUTION" | "QUALITY";
    datasetId: string;
    granularity: string;
    version: string;
    dependsOn: readonly string[];
    freshness: string;
    quality: "OK" | "WATCH" | "DEGRADED";
    lookaheadStatus: "PASS" | "WATCH" | "FAIL";
    usedBy: string;
  }[];
  lineage: readonly {
    edgeId: string;
    from: string;
    to: string;
    relation: "INGESTS" | "BUILDS" | "VALIDATES" | "FEEDS";
    status: "OK" | "WATCH" | "BLOCKED";
  }[];
  incidents: readonly {
    incidentId: string;
    datasetId: string;
    severity: "LOW" | "MEDIUM" | "HIGH";
    title: string;
    status: "OPEN" | "WATCHING" | "RESOLVED";
    retryable: boolean;
  }[];
  commandActions: readonly {
    actionId: string;
    label: string;
    datasetId: string;
    commandType: string;
    permission: "ALLOWED" | "STEP_UP_REQUIRED" | "DENIED";
    requiresConfirmation: boolean;
    payload: Record<string, string | number | boolean>;
  }[];
};

export type ResearchComputeSchedulerView = {
  summary: {
    runningJobs: number;
    queuedJobs: number;
    waitingJobs: number;
    dlqItems: number;
    activeWorkers: number;
    liveReservedPct: number;
    researchUsedPct: number;
    costTodayUsd: number;
  };
  pools: readonly {
    poolId: string;
    label: string;
    mode: "LIVE_RESERVED" | "RESEARCH" | "SHARED";
    status: "ACTIVE" | "THROTTLED" | "PAUSED";
    capacityVcpu: number;
    capacityMemoryGb: number;
    usedPct: number;
    reservedForLivePct: number;
    runningJobs: number;
    queuedJobs: number;
  }[];
  workers: readonly {
    workerId: string;
    poolId: string;
    kind: "CPU" | "GPU" | "LLM_ORCHESTRATOR";
    status: "RUNNING" | "IDLE" | "WAITING" | "DEGRADED";
    currentJobId?: string;
    heartbeatAt: string;
    cpuPct: number;
    memoryPct: number;
    gpuPct: number;
    costUsdHour: number;
  }[];
  jobs: readonly {
    jobId: string;
    missionId: string;
    experimentId?: string;
    runId?: string;
    label: string;
    state: "QUEUED" | "RUNNING" | "WAITING_EVENT" | "RETRYING" | "COMPLETED" | "FAILED";
    priority: "LOW" | "NORMAL" | "HIGH" | "LIVE_PROTECTED";
    poolId: string;
    workerId?: string;
    requestedVcpu: number;
    requestedMemoryGb: number;
    allocatedVcpu: number;
    allocatedMemoryGb: number;
    progressPct: number;
    eta: string;
    retryCount: number;
    maxRetries: number;
    startedAt?: string;
    expectedEvent: string;
    errorCode?: string;
  }[];
  reservations: readonly {
    reservationId: string;
    label: string;
    poolId: string;
    scope: "LIVE" | "RESEARCH" | "MAINTENANCE";
    reservedPct: number;
    active: boolean;
    reason: string;
  }[];
  dlq: readonly {
    dlqId: string;
    jobId: string;
    missionId: string;
    errorCode: string;
    title: string;
    retryable: boolean;
    createdAt: string;
  }[];
  commandActions: readonly {
    actionId: string;
    label: string;
    jobId?: string;
    poolId?: string;
    commandType: string;
    permission: "ALLOWED" | "STEP_UP_REQUIRED" | "DENIED";
    requiresConfirmation: boolean;
    payload: Record<string, string | number | boolean>;
  }[];
};

export type SessionsView = {
  summary: { total: number; nominal: number; attention: number; activeTheses: number; tradingDate: string };
  sessions: readonly {
    sessionId: string;
    label: string;
    shortLabel: string;
    status: string;
    severity: string;
    decision: string;
    healthPct: number;
    lastMonitorAt: string;
    tradingDate: string;
    route: string;
  }[];
};

export type LivePlanView = {
  summary: { sessionStatus: string; masterAvailable: boolean; thesisAvailable: boolean; setupAvailable: boolean; positionActive: boolean; nextMonitorAt: string };
  scope: { sessionId: string; tradingDate: string; mode: string; generatedAt: string };
  brief: { headline: string; action: string; summary: string; why: string; nextAction: string; decision: string };
  claim: { lastClaimAt: string; workerId: string; nextTaskStatus: string; nextTaskLabel: string; dueCheckpoint: string; followingCheckpoint: string; latencySeconds: number | null; latencyTargetSeconds: number | null };
  master: { available: boolean; id: string; createdAt: string; decision: string; instrument: string; direction: string; confidence: number; summary: string; regime: string; macroThesis: string; assetSelection: string; expectedPath: readonly string[]; failurePath: readonly string[]; monitoringPlaybook: readonly string[] };
  thesis: { available: boolean; id: string; instrument: string; direction: string; status: string; dominantScenario: string; secondaryScenario: string; confidence: number; health: number; validUntil: string; nextFocus: string; positiveDrivers: readonly string[]; negativeDrivers: readonly string[] };
  setup: { available: boolean; id: string; label: string; instrument: string; direction: string; status: string; geometryReady: boolean; backendCanTrigger: boolean; missingFields: readonly string[]; entryLower: number | null; entryUpper: number | null; executionEntry: number | null; executionRule: string; stop: number | null; tp1: number | null; tp2: number | null; tp3: number | null; risk: number | null; confidence: number | null; rr: number | null; reason: string };
  position: { active: boolean; status: string; instrument: string; direction: string; entry: number | null; current: number | null; unrealizedR: number | null; executionMode: string; brokerExecution: boolean; note: string };
  levels: readonly { levelId: string; label: string; value: number | null; kind: string }[];
};

export type LiveNewsView = {
  summary: { macroEvents: number; highImpactEvents: number; headlines: number; providers: number; nearEvent: boolean; nextMacroAt: string };
  scope: { sessionId: string; tradingDate: string; mode: string };
  macroEvents: readonly { eventId: string; scheduledAt: string; time: string; title: string; currency: string; importance: string; previous: string; forecast: string; actual: string; isNext: boolean }[];
  headlines: readonly { headlineId: string; publishedAt: string; title: string; source: string; provider: string; importance: string; impact: string; url: string; assets: readonly string[]; topics: readonly string[] }[];
};

export type LiveTimelineView = {
  summary: { total: number; completed: number; waiting: number; delayed: number; nextCheckpointAt: string; lastCompletedAt: string };
  scope: { sessionId: string; tradingDate: string; mode: string };
  events: readonly { eventId: string; category: string; title: string; plannedAt: string; actualAt: string | null; status: string; latencySeconds: number | null; summary: string; detail: string }[];
};

export type ExecutionReconciliationView = {
  summary: { status: "NOT_RUN" | "MISMATCH" | "MATCHED"; reconciliationRuns: number; parityRuns: number; mismatches: number; openTrades: number; activeOrders: number };
  reconciliations: readonly { reconciliationId: string; accountId: string; status: string; mismatchCount: number; checkedAt: string; source: string }[];
  parityRuns: readonly { parityRunId: string; accountId: string; leftAdapter: string; rightAdapter: string; status: string; mismatchCount: number; checkedAt: string }[];
  providers: LiveTradingView["providers"];
  accounts: readonly { accountId: string; providerId: string; label: string; mode: "LIVE" | "PAPER"; state: string; netLiqUsd: number; openPositions: number; ordersToday: number }[];
};

export type OperationsObservabilityView = {
  summary: { processes: number; queued: number; running: number; failed: number; completed: number; retries: number; successRate: number | null; avgQueueMs: number | null; avgExecutionMs: number | null; p95ExecutionMs: number | null; totalTokens: number | null; costUsd: number | null; slaBreaches: number };
  queue: { depth: number; oldestQueuedMs: number | null; activeLeases: number; expiringLeases: number; expiredLeases: number };
  coverage: Record<string, unknown>;
  runtimeSettings: { reasoningEffort: string; revision: number; source: string; appliesTo: string; supportedReasoningEfforts: readonly string[]; updatedAt: string | null };
  workerSummary: { expected: number; registered: number; healthy: number; active: number; degraded: number };
  workers: readonly { workerId: string; status: string; model: string; lastSeenAt: string; task: string }[];
  processes: readonly { processId: string; scope: string; workflow: string; runId: string; status: string; worker: string; queueMs: number | null; executionMs: number | null; totalTokens: number | null; costUsd: number | null; queueBreached: boolean; executionBreached: boolean; updatedAt: string }[];
  workflowBreakdown: readonly { label: string; processes: number; running: number; failed: number; successRate: number | null; avgExecutionMs: number | null }[];
};

export type ExplorerView = {
  summary: {
    title: string;
    description: string;
    total: number;
    metrics: readonly { label: string; value: string }[];
  };
  items: readonly {
    id: string;
    title: string;
    subtitle: string;
    status: string;
    primary: string;
    secondary: string;
    route: string | null;
    tags: readonly string[];
    facts: readonly { label: string; value: string }[];
  }[];
};

export type PerformanceDimension = "STRATEGY" | "SESSION" | "INSTRUMENT" | "DIRECTION" | "OTHER";

export type PerformanceView = {
  summary: {
    totalR: number;
    trades: number;
    wins: number;
    losses: number;
    flats: number;
    winRate: number | null;
    expectancyR: number | null;
    profitFactor: number | null;
    maxDrawdownR: number;
    currentDrawdownR: number;
    bestTradeR: number | null;
    worstTradeR: number | null;
    bestDayR: number | null;
    worstDayR: number | null;
    activeDays: number;
    winningDays: number;
    losingDays: number;
  };
  equityCurve: readonly {
    sequence: number;
    date: string;
    cumulativeR: number;
    drawdownR: number;
    resultR: number;
  }[];
  pnlByDay: readonly {
    date: string;
    totalR: number;
    trades: number;
    wins: number;
    losses: number;
    winRate: number | null;
  }[];
  breakdowns: readonly {
    dimension: PerformanceDimension;
    items: readonly { label: string; totalR: number; trades: number; winRate: number | null }[];
  }[];
  attribution: readonly {
    dimension: PerformanceDimension;
    items: readonly {
      label: string;
      totalR: number;
      trades: number;
      winRate: number | null;
      expectancyR: number | null;
      avgR: number | null;
      contributionPct: number;
      tone: "positive" | "negative" | "neutral";
    }[];
  }[];
  latestTrades: readonly {
    tradeId: string;
    at: string;
    strategyId: string | null;
    instrument: string | null;
    session: string | null;
    direction: string | null;
    resultR: number | null;
  }[];
  facets: {
    strategies: readonly string[];
    sessions: readonly string[];
    instruments: readonly string[];
  };
};

export type ReplayTimelineLayer = "decision" | "step" | "gpt" | "event";

export type ReplayOverviewView = {
  summary: {
    executions: number;
    days: number;
    active: number;
    totalR: number;
    resultEligible: number;
    gptProcesses: number;
  };
  days: readonly {
    date: string;
    status: string;
    sessionCount: number;
    totalR: number;
    totalProgress: number;
    gptProcesses: number;
    primaryRunId: string | null;
    startTime: string | null;
    endTime: string | null;
  }[];
  selectedRun: {
    runId: string;
    tradingDate: string;
    session: string;
    strategyId: string;
    status: string;
    progress: number;
    totalR: number;
    engineVersion: string;
  } | null;
  candles: readonly {
    time: string;
    open: number;
    high: number;
    low: number;
    close: number;
  }[];
  timeline: readonly {
    eventId: string;
    at: string;
    type: string;
    layer: ReplayTimelineLayer;
    title: string;
    detail: string;
    decision: string | null;
    conclusion: string | null;
    price: number | null;
    severity: string | null;
    stepId: string | null;
  }[];
  timelineCounts: {
    decision: number;
    step: number;
    gpt: number;
    event: number;
  };
};

export type ControlPlaneViews = {
  "auth-session": AuthSessionView;
  "operator-settings": OperatorSettingsView;
  "admin-access": AdminAccessView;
  "command-center": CommandCenterView;
  "demo-paper-readiness": DemoPaperReadinessView;
  "events-audit": EventsAuditView;
  "operations-queue": OperationsQueueView;
  "research-experiment-detail": ResearchExperimentDetailView;
  "research-agent-fleet": ResearchAgentFleetView;
  "research-data-catalog": ResearchDataCatalogView;
  "research-compute-scheduler": ResearchComputeSchedulerView;
  "research-run-detail": ResearchRunDetailView;
  "research-lab": ResearchLabView;
  "strategy-center": StrategyCenterView;
  "strategy-detail": StrategyDetailView;
  "strategy-compare": StrategyCompareView;
  "live-trading": LiveTradingView;
  "live-signal-detail": LiveSignalDetailView;
  "order-detail": OrderDetailView;
  "position-detail": PositionDetailView;
  "incident-detail": IncidentDetailView;
  orders: OrdersView;
  risk: RiskView;
  "execution-providers": ExecutionProvidersView;
  "execution-incidents": ExecutionIncidentsView;
  portfolio: PortfolioView;
  sessions: SessionsView;
  "live-plan": LivePlanView;
  "live-news": LiveNewsView;
  "live-timeline": LiveTimelineView;
  "execution-reconciliation": ExecutionReconciliationView;
  "operations-observability": OperationsObservabilityView;
  "research-experiments": ExplorerView;
  "research-candidates": ExplorerView;
  "research-dataset-detail": ExplorerView;
  "strategy-deployments": ExplorerView;
  "replay-overview": ReplayOverviewView;
  "replay-runs": ExplorerView;
  "replay-run-detail": ExplorerView;
  "replay-compare": ExplorerView;
  "performance-overview": PerformanceView;
  "performance-calendar": ExplorerView;
  "performance-day-detail": ExplorerView;
  "performance-strategies": ExplorerView;
  "performance-trades": ExplorerView;
  "workflow-detail": ExplorerView;
  "event-detail": ExplorerView;
  "operations-runbooks": ExplorerView;
  "governance-prompts": ExplorerView;
  "governance-policies": ExplorerView;
  "jarvis-workspace": JarvisWorkspaceView;
};

export type OrderDetailView = {
  summary: { state: string; orderedQuantity: number; filledQuantity: number; remainingQuantity: number; fillCount: number; protectionStatus: string };
  identity: { orderId: string; orderIntentId: string; signalId: string; providerId: string; brokerOrderId: string; correlationId: string; strategyInstanceId: string };
  order: OrdersView["activeOrders"][number];
  intent: OrdersView["orderIntents"][number] | null;
  authority?: {
    strategy: { strategyId: string; strategyInstanceId: string; strategyVersion: string };
    signal: { signalId: string; instrument: string; side: "BUY" | "SELL" };
    contextGate: { label: string; decision: string; reasonCodes: readonly string[]; authorityId: string; version: string };
    portfolioArbitration: { label: string; decision: string; reasonCodes: readonly string[]; authorityId: string; version: string };
    globalRisk: { label: string; decision: string; reasonCodes: readonly string[]; authorityId: string; version: string };
    targetPosition: { targetPositionId: string; account: string; authorizedQuantity: number };
  } | null;
  executionMode?: "SHADOW" | "SEMI_MANUAL" | "PAPER" | "LIVE" | null;
  humanGate?: {
    gateId: string;
    status: string;
    revision: number;
    expiresAt: string;
    confirmedAt: string;
    rejectedAt: string;
    actions: readonly {
      action: "CONFIRM" | "REJECT";
      actionId: string;
      label: string;
      commandType: string;
      environment: "MOCK" | "SHADOW" | "PAPER" | "LIVE";
      permission: "ALLOWED" | "STEP_UP_REQUIRED" | "DENIED";
      requiresConfirmation: boolean;
      requiresReason: boolean;
      expectedRevision: string;
      impactPreview: string;
      payload: Record<string, string | number | boolean>;
    }[];
    unavailableReason: string;
  } | null;
  reconciliation?: {
    status: string;
    checkedAt: string;
    expected: readonly { label: string; value: string | number }[];
    broker: readonly { label: string; value: string | number }[];
    mismatches: readonly { field: string; expected: string; actual: string; reason: string }[];
  } | null;
  fills: OrdersView["fills"];
  protections: OrdersView["protections"];
  lifecycle: readonly { eventId: string; at: string; state: string; detail: string }[];
  relations: readonly { label: string; id: string; route: string }[];
};

export type PositionDetailView = {
  summary: { state: string; quantity: number; pnlR: number; riskR: number; protectionStatus: string };
  identity: { positionId: string; strategyInstanceId: string; signalId: string; correlationId: string };
  position: { positionId: string; strategyInstanceId: string; symbol: string; side: "LONG" | "SHORT" | "FLAT"; quantity: number; averagePrice: number; riskR: number; pnlR: number; protectionStatus: "PROTECTED" | "PENDING" | "UNPROTECTED"; state: string; stopPrice?: number; targetPrice?: number; openedAt: string; closedAt?: string };
  orders: OrdersView["activeOrders"];
  lifecycle: readonly { eventId: string; at: string; state: string; detail: string }[];
  relations: readonly { label: string; id: string; route: string }[];
};

export type IncidentDetailView = {
  summary: { severity: ExecutionIncidentSeverity; status: ExecutionIncidentStatus; retryCount: number; operatorGate: string };
  incident: ExecutionIncidentsView["incidents"][number] & { detail: string };
  payloadPreview: ExecutionIncidentsView["selectedIncident"]["payloadPreview"];
  meta: ExecutionIncidentsView["selectedIncident"]["meta"];
  chronology: ExecutionIncidentsView["selectedIncident"]["chronology"];
  reconciliationResults: ExecutionIncidentsView["selectedIncident"]["reconciliationResults"];
  postMortem: ExecutionIncidentsView["selectedIncident"]["postMortem"];
  retries: ExecutionIncidentsView["retries"];
  relations: readonly { label: string; id: string; route: string }[];
};

export function isSessionsView(value: unknown): value is SessionsView {
  const candidate = value as Partial<SessionsView>;
  return Boolean(candidate?.summary && Array.isArray(candidate.sessions));
}

export function isLivePlanView(value: unknown): value is LivePlanView {
  const candidate = value as Partial<LivePlanView>;
  return Boolean(candidate?.summary && candidate.scope && candidate.brief && candidate.claim && candidate.master && candidate.thesis && candidate.setup && candidate.position && Array.isArray(candidate.levels));
}

export function isLiveNewsView(value: unknown): value is LiveNewsView {
  const candidate = value as Partial<LiveNewsView>;
  return Boolean(candidate?.summary && candidate.scope && Array.isArray(candidate.macroEvents) && Array.isArray(candidate.headlines));
}

export function isLiveTimelineView(value: unknown): value is LiveTimelineView {
  const candidate = value as Partial<LiveTimelineView>;
  return Boolean(candidate?.summary && candidate.scope && Array.isArray(candidate.events));
}

export function isExecutionReconciliationView(value: unknown): value is ExecutionReconciliationView {
  const candidate = value as Partial<ExecutionReconciliationView>;
  return Boolean(candidate?.summary && Array.isArray(candidate.reconciliations) && Array.isArray(candidate.parityRuns) && Array.isArray(candidate.providers) && Array.isArray(candidate.accounts));
}

export function isOperationsObservabilityView(value: unknown): value is OperationsObservabilityView {
  const candidate = value as Partial<OperationsObservabilityView>;
  return Boolean(candidate?.summary && candidate.queue && candidate.coverage && candidate.runtimeSettings && candidate.workerSummary && Array.isArray(candidate.workers) && Array.isArray(candidate.processes) && Array.isArray(candidate.workflowBreakdown));
}

export function isExplorerView(value: unknown): value is ExplorerView {
  const candidate = value as Partial<ExplorerView>;
  return Boolean(candidate?.summary && Array.isArray(candidate.summary.metrics) && Array.isArray(candidate.items));
}

export function isPortfolioView(value: unknown): value is PortfolioView {
  const candidate = value as Partial<PortfolioView>;
  return Boolean(
    candidate?.summary &&
      candidate?.summaryTruth &&
      Array.isArray(candidate.positions) &&
      Array.isArray(candidate.equityCurve) &&
      Array.isArray(candidate.exposureTree) &&
      Array.isArray(candidate.brokerPositions) &&
      candidate.correlationMatrix &&
      Array.isArray(candidate.virtualAllocations) &&
      candidate.reconciliation &&
      candidate.attribution
  );
}

export function isAuthSessionView(value: unknown): value is AuthSessionView {
  const candidate = value as Partial<AuthSessionView>;
  return Boolean(
    candidate?.summary &&
      candidate?.principal &&
      candidate?.session &&
      Array.isArray(candidate.environments) &&
      Array.isArray(candidate.permissions) &&
      Array.isArray(candidate.routeGuards) &&
      candidate?.stepUp &&
      Array.isArray(candidate.stepUp.methods) &&
      Array.isArray(candidate.events) &&
      Array.isArray(candidate.commandActions)
  );
}

export function isOperatorSettingsView(value: unknown): value is OperatorSettingsView {
  const candidate = value as Partial<OperatorSettingsView>;
  return Boolean(
    candidate?.summary &&
      Array.isArray(candidate.cockpitPreferences) &&
      Array.isArray(candidate.widgets) &&
      Array.isArray(candidate.notificationRules) &&
      candidate?.jarvis &&
      Array.isArray(candidate.shortcuts) &&
      Array.isArray(candidate.devices) &&
      Array.isArray(candidate.privacy) &&
      Array.isArray(candidate.guardrails) &&
      Array.isArray(candidate.commandActions)
  );
}

export function isAdminAccessView(value: unknown): value is AdminAccessView {
  const candidate = value as Partial<AdminAccessView>;
  return Boolean(
    candidate?.summary &&
      candidate?.currentAccess &&
      Array.isArray(candidate.users) &&
      Array.isArray(candidate.roles) &&
      Array.isArray(candidate.capabilities) &&
      Array.isArray(candidate.accountGroups) &&
      Array.isArray(candidate.policies) &&
      Array.isArray(candidate.providerAccess) &&
      Array.isArray(candidate.auditEvents) &&
      Array.isArray(candidate.commandActions)
  );
}

export function isCommandCenterView(value: unknown): value is CommandCenterView {
  const candidate = value as Partial<CommandCenterView>;
  return Boolean(
    candidate?.mode &&
      candidate?.summary &&
      Array.isArray(candidate.systems) &&
      Array.isArray(candidate.activity) &&
      candidate.risk &&
      Array.isArray(candidate.lanes) &&
      Array.isArray(candidate.upcoming) &&
      candidate.market &&
      candidate.research &&
      candidate.signals &&
      candidate.humanGate &&
      candidate.provider &&
      candidate.performance &&
      Array.isArray(candidate.incidents) &&
      candidate.assistant &&
      Array.isArray(candidate.audit)
  );
}

export function isOperationsQueueView(value: unknown): value is OperationsQueueView {
  const candidate = value as Partial<OperationsQueueView>;
  return Boolean(
    candidate?.summary &&
      Array.isArray(candidate.missions) &&
      Array.isArray(candidate.eventFlow) &&
      Array.isArray(candidate.policyGates) &&
      Array.isArray(candidate.deadLetters) &&
      Array.isArray(candidate.incidents) &&
      Array.isArray(candidate.commandActions)
  );
}

export function isEventsAuditView(value: unknown): value is EventsAuditView {
  const candidate = value as Partial<EventsAuditView>;
  return Boolean(
    candidate?.summary &&
      candidate.filters &&
      Array.isArray(candidate.events) &&
      candidate.selectedCorrelation &&
      Array.isArray(candidate.relations) &&
      Array.isArray(candidate.commandActions)
  );
}

export function isResearchExperimentDetailView(value: unknown): value is ResearchExperimentDetailView {
  const candidate = value as Partial<ResearchExperimentDetailView>;
  return Boolean(
    candidate?.experiment &&
      candidate.ownership &&
      Array.isArray(candidate.datasets) &&
      candidate.strategySpec &&
      Array.isArray(candidate.versions) &&
      Array.isArray(candidate.iterations) &&
      Array.isArray(candidate.segmentedMetrics) &&
      Array.isArray(candidate.agentJournal) &&
      Array.isArray(candidate.knowledgeCreated) &&
      Array.isArray(candidate.commandActions)
  );
}

export function isResearchRunDetailView(value: unknown): value is ResearchRunDetailView {
  const candidate = value as Partial<ResearchRunDetailView>;
  return Boolean(
    candidate?.run &&
      Array.isArray(candidate.parameters) &&
      candidate.summary &&
      Array.isArray(candidate.equityCurve) &&
      Array.isArray(candidate.distribution) &&
      Array.isArray(candidate.regimePerformance) &&
      Array.isArray(candidate.hourlyPerformance) &&
      Array.isArray(candidate.ambiguity) &&
      candidate.benchmark &&
      Array.isArray(candidate.trades) &&
      Array.isArray(candidate.commandActions)
  );
}

export function isResearchAgentFleetView(value: unknown): value is ResearchAgentFleetView {
  const candidate = value as Partial<ResearchAgentFleetView>;
  return Boolean(
    candidate?.summary &&
      Array.isArray(candidate.agents) &&
      Array.isArray(candidate.queue) &&
      Array.isArray(candidate.conversations) &&
      Array.isArray(candidate.incidents) &&
      Array.isArray(candidate.commandActions)
  );
}

export function isResearchDataCatalogView(value: unknown): value is ResearchDataCatalogView {
  const candidate = value as Partial<ResearchDataCatalogView>;
  return Boolean(
    candidate?.summary &&
      Array.isArray(candidate.datasets) &&
      Array.isArray(candidate.instruments) &&
      Array.isArray(candidate.features) &&
      Array.isArray(candidate.lineage) &&
      Array.isArray(candidate.incidents) &&
      Array.isArray(candidate.commandActions)
  );
}

export function isResearchComputeSchedulerView(value: unknown): value is ResearchComputeSchedulerView {
  const candidate = value as Partial<ResearchComputeSchedulerView>;
  return Boolean(
    candidate?.summary &&
      Array.isArray(candidate.pools) &&
      Array.isArray(candidate.workers) &&
      Array.isArray(candidate.jobs) &&
      Array.isArray(candidate.reservations) &&
      Array.isArray(candidate.dlq) &&
      Array.isArray(candidate.commandActions)
  );
}

export function isLiveTradingView(value: unknown): value is LiveTradingView {
  const candidate = value as Partial<LiveTradingView>;
  return Boolean(
    candidate?.summary &&
      candidate.session &&
      Array.isArray(candidate.pipeline) &&
      candidate.canonicalRuntime &&
      candidate.canonicalRuntime.mode &&
      Array.isArray(candidate.canonicalRuntime.authoritativeSources) &&
      Array.isArray(candidate.canonicalRuntime.pipeline) &&
      Array.isArray(candidate.canonicalRuntime.activeStrategyInstances) &&
      Array.isArray(candidate.canonicalRuntime.latestSignals) &&
      Array.isArray(candidate.canonicalRuntime.aiContextGate) &&
      Array.isArray(candidate.canonicalRuntime.pendingOrderIntents) &&
      candidate.launchGate &&
      typeof candidate.launchGate.finalDecision === "string" &&
      typeof candidate.launchGate.releaseCheckCommand === "string" &&
      Array.isArray(candidate.launchGate.components) &&
      Array.isArray(candidate.launchGate.checks) &&
      Array.isArray(candidate.launchGate.blockers) &&
      Array.isArray(candidate.launchGate.operatorActions) &&
      Array.isArray(candidate.signals) &&
      Array.isArray(candidate.arbitrations) &&
      Array.isArray(candidate.riskChecks) &&
      Array.isArray(candidate.portfolioOrderIntents) &&
      Array.isArray(candidate.orders) &&
      Array.isArray(candidate.fills) &&
      Array.isArray(candidate.positions) &&
      Array.isArray(candidate.providers) &&
      Array.isArray(candidate.incidents) &&
      Array.isArray(candidate.timeline) &&
      candidate.timeSeriesContracts &&
      (Array.isArray(candidate.timeSeriesContracts.series) || Array.isArray(candidate.timeSeriesContracts.contracts)) &&
      candidate.telegramDrilldown &&
      candidate.aiAdvisory
  );
}

export function isDemoPaperReadinessView(value: unknown): value is DemoPaperReadinessView {
  const candidate = value as Partial<DemoPaperReadinessView>;
  return Boolean(
    candidate?.summary &&
      candidate.launchGate &&
      candidate.marketData &&
      candidate.broker &&
      candidate.commands &&
      Array.isArray(candidate.components) &&
      Array.isArray(candidate.actionItems) &&
      Array.isArray(candidate.marketData.coreFeeds) &&
      Array.isArray(candidate.links)
  );
}

export function isLiveSignalDetailView(value: unknown): value is LiveSignalDetailView {
  const candidate = value as Partial<LiveSignalDetailView>;
  return Boolean(
    candidate?.summary &&
      candidate.identity &&
      candidate.signal &&
      Array.isArray(candidate.predicates) &&
      candidate.featureSnapshot &&
      Array.isArray(candidate.featureSnapshot.items) &&
      Array.isArray(candidate.context) &&
      Array.isArray(candidate.conflicts) &&
      Array.isArray(candidate.existingPositions) &&
      candidate.arbitration &&
      candidate.riskCheck &&
      Array.isArray(candidate.linkedOrders) &&
      Array.isArray(candidate.auditTrail) &&
      candidate.aiAdvisory &&
      Array.isArray(candidate.navigation) &&
      Array.isArray(candidate.commandActions)
  );
}

export function isOrdersView(value: unknown): value is OrdersView {
  const candidate = value as Partial<OrdersView>;
  return Boolean(
    candidate?.summary &&
      candidate.filters &&
      Array.isArray(candidate.orderIntents) &&
      Array.isArray(candidate.activeOrders) &&
      Array.isArray(candidate.fills) &&
      Array.isArray(candidate.protections) &&
      Array.isArray(candidate.providers) &&
      Array.isArray(candidate.stateMachine) &&
      Array.isArray(candidate.history) &&
      Array.isArray(candidate.commandActions)
  );
}

export function isRiskView(value: unknown): value is RiskView {
  const candidate = value as Partial<RiskView>;
  return Boolean(
    candidate?.summary &&
      Array.isArray(candidate.limits) &&
      Array.isArray(candidate.exposures) &&
      Array.isArray(candidate.correlations) &&
      Array.isArray(candidate.propConstraints) &&
      Array.isArray(candidate.stressTests) &&
      Array.isArray(candidate.breaches) &&
      Array.isArray(candidate.commandActions)
  );
}

export function isExecutionProvidersView(value: unknown): value is ExecutionProvidersView {
  const candidate = value as Partial<ExecutionProvidersView>;
  return Boolean(
    candidate?.summary &&
      Array.isArray(candidate.providers) &&
      Array.isArray(candidate.accounts) &&
      Array.isArray(candidate.adapters) &&
      Array.isArray(candidate.healthChecks) &&
      Array.isArray(candidate.switchWorkflow) &&
      Array.isArray(candidate.events) &&
      Array.isArray(candidate.incidents) &&
      Array.isArray(candidate.commandActions)
  );
}

export function isPerformanceView(value: unknown): value is PerformanceView {
  const candidate = value as Partial<PerformanceView>;
  return Boolean(
    candidate?.summary &&
      Array.isArray(candidate.equityCurve) &&
      Array.isArray(candidate.pnlByDay) &&
      Array.isArray(candidate.breakdowns) &&
      Array.isArray(candidate.attribution) &&
      Array.isArray(candidate.latestTrades) &&
      candidate?.facets
  );
}

export function isReplayOverviewView(value: unknown): value is ReplayOverviewView {
  const candidate = value as Partial<ReplayOverviewView>;
  return Boolean(
    candidate?.summary &&
      Array.isArray(candidate.days) &&
      Array.isArray(candidate.candles) &&
      Array.isArray(candidate.timeline) &&
      candidate?.timelineCounts
  );
}

export function isExecutionIncidentsView(value: unknown): value is ExecutionIncidentsView {
  const candidate = value as Partial<ExecutionIncidentsView>;
  return Boolean(
    candidate?.summary &&
      candidate?.filters &&
      Array.isArray(candidate.incidents) &&
      candidate?.selectedIncident &&
      Array.isArray(candidate.selectedIncident.chronology) &&
      Array.isArray(candidate.selectedIncident.reconciliationResults) &&
      Array.isArray(candidate.retries) &&
      Array.isArray(candidate.commandActions)
  );
}

export function isOrderDetailView(value: unknown): value is OrderDetailView {
  const candidate = value as Partial<OrderDetailView>;
  return Boolean(candidate?.summary && candidate?.identity?.orderId && candidate?.order?.orderId && Array.isArray(candidate.fills) && Array.isArray(candidate.protections) && Array.isArray(candidate.lifecycle) && Array.isArray(candidate.relations));
}

export function isPositionDetailView(value: unknown): value is PositionDetailView {
  const candidate = value as Partial<PositionDetailView>;
  return Boolean(candidate?.summary && candidate?.identity?.positionId && candidate?.position?.positionId && Array.isArray(candidate.orders) && Array.isArray(candidate.lifecycle) && Array.isArray(candidate.relations));
}

export function isIncidentDetailView(value: unknown): value is IncidentDetailView {
  const candidate = value as Partial<IncidentDetailView>;
  return Boolean(candidate?.summary && candidate?.incident?.incidentId && Array.isArray(candidate.payloadPreview) && Array.isArray(candidate.meta) && Array.isArray(candidate.chronology) && Array.isArray(candidate.reconciliationResults) && candidate.postMortem && Array.isArray(candidate.retries) && Array.isArray(candidate.relations));
}

export function isResearchLabView(value: unknown): value is ResearchLabView {
  const candidate = value as Partial<ResearchLabView>;
  return Boolean(
    candidate?.summary &&
      Array.isArray(candidate.pipeline) &&
      Array.isArray(candidate.experiments) &&
      Array.isArray(candidate.agents) &&
      Array.isArray(candidate.coverage) &&
      Array.isArray(candidate.results) &&
      candidate.knowledgeGraph &&
      Array.isArray(candidate.computeQueue) &&
      Array.isArray(candidate.datasets) &&
      Array.isArray(candidate.incidents) &&
      Array.isArray(candidate.commandActions)
  );
}

export function isStrategyCenterView(value: unknown): value is StrategyCenterView {
  const candidate = value as Partial<StrategyCenterView>;
  return Boolean(
    candidate?.summary &&
      Array.isArray(candidate.strategies) &&
      Array.isArray(candidate.lifecycleDistribution) &&
      Array.isArray(candidate.performanceByFamily) &&
      Array.isArray(candidate.topStrategies) &&
      Array.isArray(candidate.recentEvents) &&
      candidate.selectedInspector
  );
}

export function isStrategyDetailView(value: unknown): value is StrategyDetailView {
  const candidate = value as Partial<StrategyDetailView>;
  return Boolean(
    candidate?.summary &&
      candidate.identity &&
      candidate.definition &&
      candidate.strategySpec &&
      Array.isArray(candidate.strategySpec.rules) &&
      Array.isArray(candidate.strategySpec.levels) &&
      Array.isArray(candidate.constraints) &&
      Array.isArray(candidate.regimes) &&
      Array.isArray(candidate.versions) &&
      Array.isArray(candidate.instances) &&
      Array.isArray(candidate.performance) &&
      Array.isArray(candidate.signals) &&
      Array.isArray(candidate.trades) &&
      Array.isArray(candidate.incidents) &&
      Array.isArray(candidate.correlations) &&
      candidate.riskAllocation &&
      Array.isArray(candidate.commandActions)
  );
}

export function isStrategyCompareView(value: unknown): value is StrategyCompareView {
  const candidate = value as Partial<StrategyCompareView>;
  return Boolean(
    candidate?.summary &&
      candidate.strategy &&
      Array.isArray(candidate.versions) &&
      Array.isArray(candidate.specDiffs) &&
      Array.isArray(candidate.parameterDiffs) &&
      Array.isArray(candidate.metricComparison) &&
      Array.isArray(candidate.regimeComparison) &&
      Array.isArray(candidate.divergentTrades) &&
      Array.isArray(candidate.costs) &&
      Array.isArray(candidate.parity) &&
      Array.isArray(candidate.deepLinks) &&
      Array.isArray(candidate.commandActions)
  );
}

export function isJarvisWorkspaceView(value: unknown): value is JarvisWorkspaceView {
  const candidate = value as Partial<JarvisWorkspaceView>;
  return Boolean(
    candidate?.summary &&
      Array.isArray(candidate.missions) &&
      Array.isArray(candidate.morningBrief) &&
      Array.isArray(candidate.suggestions) &&
      Array.isArray(candidate.conversation) &&
      Array.isArray(candidate.citations) &&
      candidate.deskSnapshot &&
      Array.isArray(candidate.pendingActions) &&
      Array.isArray(candidate.alerts) &&
      candidate.voice &&
      Array.isArray(candidate.commands)
  );
}
