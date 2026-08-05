// DeskExecutionAddOn — PREPROD locale, NinjaTrader 8, comptes Sim* uniquement.
// Références NinjaScript requises : System.Net.Http et System.Web.Extensions
// (présentes nativement dans le projet NinjaTrader 8).
using System;
using System.Collections;
using System.Collections.Concurrent;
using System.Collections.Generic;
using System.Globalization;
using System.IO;
using System.Linq;
using System.Net.Http;
using System.Reflection;
using System.Security.Cryptography;
using System.Text;
using System.Threading;
using System.Threading.Tasks;
using System.Web.Script.Serialization;
using NinjaTrader.Cbi;
using NinjaTrader.NinjaScript;

namespace NinjaTrader.NinjaScript.AddOns
{
    public class DeskExecutionAddOn : AddOnBase
    {
        private const string ProtocolVersion = "desk_ninja_addon_v1";
        private const string AddOnMode = "sim101_addon_approved_only";
        private readonly ConcurrentQueue<AddonEvent> pendingEvents = new ConcurrentQueue<AddonEvent>();
        private readonly ConcurrentDictionary<Order, CommandContext> deskOrders = new ConcurrentDictionary<Order, CommandContext>();
        private readonly ConcurrentDictionary<string, CommandContext> activeInstrumentContexts = new ConcurrentDictionary<string, CommandContext>(StringComparer.OrdinalIgnoreCase);
        private readonly ConcurrentDictionary<string, CommandContext> pendingCloseContexts = new ConcurrentDictionary<string, CommandContext>(StringComparer.OrdinalIgnoreCase);
        private readonly ConcurrentDictionary<string, byte> processedCommands = new ConcurrentDictionary<string, byte>(StringComparer.Ordinal);
        private readonly object commandJournalLock = new object();
        private readonly HttpClient http = new HttpClient { Timeout = TimeSpan.FromSeconds(5) };
        private CancellationTokenSource cancellation;
        private Task transportLoop;
        private Account simAccount;
        private string accountName;
        private string apiBaseUrl;
        private string bridgeId;
        private string brokerAccountId;
        private string sharedSecret;
        private string commandJournalPath;
        private bool localCommandsEnabled;

        protected override void OnStateChange()
        {
            if (State == State.SetDefaults)
                Name = "DeskExecutionAddOn";
            else if (State == State.Active)
                StartAddOn();
            else if (State == State.Terminated)
                StopAddOn();
        }

        private void StartAddOn()
        {
            accountName = Env("DESK_NINJA_ACCOUNT_NAME", "Sim101");
            apiBaseUrl = Env("DESK_NINJA_ADDON_API_BASE_URL", "http://127.0.0.1:8787/api/v1").TrimEnd('/');
            brokerAccountId = Env("DESK_NINJA_BROKER_ACCOUNT_ID", "ninjatrader_paper_local");
            sharedSecret = Env("DESK_NINJA_ADDON_SHARED_SECRET", string.Empty);
            bridgeId = Sanitize(Environment.MachineName + "_nt8_addon");
            commandJournalPath = Path.Combine(
                Environment.GetFolderPath(Environment.SpecialFolder.LocalApplicationData),
                "DeskFutures",
                "ninjatrader-processed-" + Sanitize(accountName) + ".log");
            LoadCommandJournal();
            localCommandsEnabled = string.Equals(Env("DESK_NINJA_ADDON_COMMANDS_ENABLED", "false"), "true", StringComparison.OrdinalIgnoreCase)
                && string.Equals(Env("DESK_NINJA_BRIDGE_MODE", "disabled"), AddOnMode, StringComparison.Ordinal)
                && IsSimulationAccount(accountName)
                && sharedSecret.Length >= 32;

            if (!IsSimulationAccount(accountName))
            {
                Print("DeskExecutionAddOn: account refused; DESK_NINJA_ACCOUNT_NAME must match Sim*.");
                return;
            }
            lock (Account.All)
                simAccount = Account.All.FirstOrDefault(account => string.Equals(account.Name, accountName, StringComparison.OrdinalIgnoreCase));
            if (simAccount == null)
            {
                Print("DeskExecutionAddOn: configured simulation account not found: " + accountName + ".");
                return;
            }
            simAccount.AccountItemUpdate += OnAccountItemUpdate;
            simAccount.OrderUpdate += OnOrderUpdate;
            simAccount.ExecutionUpdate += OnExecutionUpdate;
            simAccount.PositionUpdate += OnPositionUpdate;
            cancellation = new CancellationTokenSource();
            transportLoop = Task.Run(() => RunTransportLoop(cancellation.Token));
            Print("DeskExecutionAddOn: " + accountName + " connected; mode=" + (localCommandsEnabled ? "approved-only" : "shadow-read-only") + ".");
        }

        private void StopAddOn()
        {
            if (cancellation != null) cancellation.Cancel();
            if (simAccount != null)
            {
                simAccount.AccountItemUpdate -= OnAccountItemUpdate;
                simAccount.OrderUpdate -= OnOrderUpdate;
                simAccount.ExecutionUpdate -= OnExecutionUpdate;
                simAccount.PositionUpdate -= OnPositionUpdate;
            }
            simAccount = null;
            cancellation = null;
            transportLoop = null;
        }

        private async Task RunTransportLoop(CancellationToken token)
        {
            DateTime nextHeartbeat = DateTime.MinValue;
            DateTime nextSnapshot = DateTime.MinValue;
            while (!token.IsCancellationRequested)
            {
                try
                {
                    DateTime now = DateTime.UtcNow;
                    if (now >= nextHeartbeat)
                    {
                        await PostAsync<HeartbeatRequest, HeartbeatResponse>("/execution/addon/heartbeat", BuildHeartbeat(), token).ConfigureAwait(false);
                        nextHeartbeat = now.AddSeconds(5);
                    }
                    if (now >= nextSnapshot)
                    {
                        await PostAsync<SnapshotRequest, SnapshotResponse>("/execution/addon/snapshot", BuildSnapshot(), token).ConfigureAwait(false);
                        nextSnapshot = now.AddSeconds(15);
                    }
                    await FlushEvents(token).ConfigureAwait(false);
                    if (localCommandsEnabled && IsConnected()) await PollOneCommand(token).ConfigureAwait(false);
                }
                catch (OperationCanceledException) { }
                catch (Exception error)
                {
                    Print("DeskExecutionAddOn transport error: " + error.Message);
                }
                try { await Task.Delay(1000, token).ConfigureAwait(false); }
                catch (OperationCanceledException) { }
            }
        }

        private HeartbeatRequest BuildHeartbeat()
        {
            return new HeartbeatRequest
            {
                BridgeId = bridgeId,
                BrokerAccountId = brokerAccountId,
                Mode = AddOnMode,
                Status = localCommandsEnabled ? "armed_requested" : "shadow",
                HostName = Environment.MachineName,
                ProcessId = System.Diagnostics.Process.GetCurrentProcess().Id,
                NinjaConnected = IsConnected(),
                CommandEnabled = localCommandsEnabled && IsConnected(),
                AccountName = accountName,
                ProtocolVersion = ProtocolVersion,
                Capabilities = new Dictionary<string, object>
                {
                    { "heartbeat", true }, { "snapshots", true }, { "events", true },
                    { "approved_commands", true }, { "atm_entry", true }, { "position_management", true }
                }
            };
        }

        private SnapshotRequest BuildSnapshot()
        {
            List<Dictionary<string, object>> orders = new List<Dictionary<string, object>>();
            List<Dictionary<string, object>> positions = new List<Dictionary<string, object>>();
            lock (simAccount.Orders)
                foreach (Order order in simAccount.Orders)
                    orders.Add(OrderPayload(order));
            lock (simAccount.Positions)
                foreach (Position position in simAccount.Positions)
                    positions.Add(PositionPayload(position));
            return new SnapshotRequest
            {
                BridgeId = bridgeId,
                BrokerAccountId = brokerAccountId,
                Reconcile = false,
                LockOnDivergence = false,
                Snapshot = new AddonSnapshot
                {
                    CapturedAt = Utc(DateTime.UtcNow),
                    Connection = ConnectionPayload(),
                    Account = new Dictionary<string, object>
                    {
                        { "account_name", accountName }, { "currency", simAccount.Denomination.ToString() },
                        { "cash_value", SafeAccountValue(AccountItem.CashValue) },
                        { "net_liquidation_value", SafeAccountValue(AccountItem.NetLiquidation) },
                        { "buying_power", SafeAccountValue(AccountItem.BuyingPower) },
                        { "realized_pnl", SafeAccountValue(AccountItem.RealizedProfitLoss) },
                        { "unrealized_pnl", SafeAccountValue(AccountItem.UnrealizedProfitLoss) },
                        { "open_position_count", positions.Count(item => Convert.ToInt32(item["quantity"]) > 0) }
                    },
                    Orders = orders,
                    Positions = positions
                }
            };
        }

        private async Task FlushEvents(CancellationToken token)
        {
            List<AddonEvent> batch = new List<AddonEvent>();
            AddonEvent item;
            while (batch.Count < 100 && pendingEvents.TryDequeue(out item)) batch.Add(item);
            if (batch.Count == 0) return;
            try
            {
                await PostAsync<EventBatchRequest, EventBatchResponse>("/execution/addon/events", new EventBatchRequest { BridgeId = bridgeId, BrokerAccountId = brokerAccountId, Events = batch }, token).ConfigureAwait(false);
            }
            catch
            {
                foreach (AddonEvent entry in batch) pendingEvents.Enqueue(entry);
                throw;
            }
        }

        private async Task PollOneCommand(CancellationToken token)
        {
            ClaimResponse response = await PostAsync<ClaimRequest, ClaimResponse>("/execution/addon/claim", new ClaimRequest
            {
                BridgeId = bridgeId, BrokerAccountId = brokerAccountId, AccountName = accountName, LeaseSeconds = 30
            }, token).ConfigureAwait(false);
            if (response == null || !string.Equals(response.Status, "CLAIMED", StringComparison.OrdinalIgnoreCase) || response.Work == null || response.Work.Command == null) return;
            CompleteRequest completion = new CompleteRequest
            {
                BridgeId = bridgeId, OutboxId = response.Work.OutboxId, LeaseToken = response.Work.LeaseToken,
                WorkType = response.Work.WorkType, Status = "failed"
            };
            try
            {
                ExecuteApprovedCommand(response.Work.Command);
                completion.Status = "delivered";
                completion.RenderedCommand = Serialize(response.Work.Command);
            }
            catch (Exception error)
            {
                completion.Error = error.Message;
                QueueCommandEvent(response.Work.Command, "failed", error.Message);
            }
            await PostAsync<CompleteRequest, CompleteResponse>("/execution/addon/complete", completion, token).ConfigureAwait(false);
        }

        private void ExecuteApprovedCommand(AddonCommand command)
        {
            if (!localCommandsEnabled || !IsConnected()) throw new InvalidOperationException("ADDON_NOT_ARMED");
            if (!IsSimulationAccount(command.AccountName) || !string.Equals(command.AccountName, simAccount.Name, StringComparison.OrdinalIgnoreCase)) throw new InvalidOperationException("SIM_ACCOUNT_MISMATCH");
            if (!string.Equals(command.SchemaVersion, ProtocolVersion, StringComparison.Ordinal)) throw new InvalidOperationException("PROTOCOL_VERSION_MISMATCH");
            if (DateTime.Parse(command.ExpiresAt).ToUniversalTime() <= DateTime.UtcNow) throw new InvalidOperationException("COMMAND_EXPIRED");
            if (command.Quantity <= 0) throw new InvalidOperationException("QUANTITY_INVALID");
            Instrument instrument = Instrument.GetInstrument(command.Instrument);
            if (instrument == null) throw new InvalidOperationException("INSTRUMENT_NOT_FOUND");
            if (IsCommandAlreadyApplied(command))
            {
                QueueCommandEvent(command, "duplicate_ignored", null);
                return;
            }
            if (command.Action == "place_entry") PlaceAtmEntry(command, instrument);
            else if (command.Action == "move_stop") MoveStop(command);
            else if (command.Action == "reduce_position") SubmitReduction(command, instrument);
            else if (command.Action == "close_position") ClosePosition(command, instrument);
            else throw new InvalidOperationException("COMMAND_ACTION_UNSUPPORTED");
            MarkCommandProcessed(command.CommandId);
            QueueCommandEvent(command, "submitted", null);
        }

        private void PlaceAtmEntry(AddonCommand command, Instrument instrument)
        {
            if (string.IsNullOrWhiteSpace(command.AtmStrategyName)) throw new InvalidOperationException("ATM_TEMPLATE_REQUIRED");
            Order order = simAccount.CreateOrder(
                instrument, command.Side == "BUY" ? OrderAction.Buy : OrderAction.Sell,
                ToOrderType(command.OrderType), OrderEntry.Automated, ToTimeInForce(command.TimeInForce), command.Quantity,
                command.LimitPrice.GetValueOrDefault(0), command.StopPrice.GetValueOrDefault(0), string.Empty, CommandOrderName(command),
                Core.Globals.MaxDate, null);
            CommandContext context = new CommandContext(command);
            deskOrders[order] = context;
            activeInstrumentContexts[instrument.FullName] = context;
            NinjaTrader.NinjaScript.AtmStrategy.StartAtmStrategy(command.AtmStrategyName, order);
        }

        private void MoveStop(AddonCommand command)
        {
            Order order;
            lock (simAccount.Orders)
                order = simAccount.Orders.FirstOrDefault(candidate => string.Equals(candidate.OrderId, command.BrokerOrderRef, StringComparison.Ordinal));
            if (order == null || (order.OrderType != OrderType.StopMarket && order.OrderType != OrderType.StopLimit)) throw new InvalidOperationException("PROTECTIVE_STOP_NOT_FOUND");
            order.StopPriceChanged = command.StopPrice.GetValueOrDefault();
            order.QuantityChanged = command.Quantity;
            deskOrders[order] = new CommandContext(command);
            simAccount.Change(new[] { order });
        }

        private void SubmitReduction(AddonCommand command, Instrument instrument)
        {
            Order order = simAccount.CreateOrder(
                instrument, command.Side == "BUY" ? OrderAction.Buy : OrderAction.Sell,
                OrderType.Market, OrderEntry.Automated, TimeInForce.Day, command.Quantity,
                0, 0, string.Empty, CommandOrderName(command), Core.Globals.MaxDate, null);
            deskOrders[order] = new CommandContext(command);
            simAccount.Submit(new[] { order });
        }

        private void ClosePosition(AddonCommand command, Instrument instrument)
        {
            pendingCloseContexts[instrument.FullName] = new CommandContext(command);
            simAccount.Flatten(new[] { instrument });
        }

        private void OnOrderUpdate(object sender, OrderEventArgs e)
        {
            CommandContext context;
            bool managed = deskOrders.TryGetValue(e.Order, out context);
            if (!managed && pendingCloseContexts.TryGetValue(e.Order.Instrument.FullName, out context) && IsCloseMarketOrder(e.Order, context.Command.Side))
            {
                deskOrders[e.Order] = context;
                managed = true;
            }
            if (!managed && activeInstrumentContexts.TryGetValue(e.Order.Instrument.FullName, out context) && context.EntryFilled && IsProtectiveOrder(e.Order))
            {
                deskOrders[e.Order] = context;
                managed = true;
            }
            if (managed && context != null && context.Command.Action == "place_entry" && IsProtectiveOrder(e.Order))
            {
                if (e.Order.OrderType == OrderType.StopMarket || e.Order.OrderType == OrderType.StopLimit)
                {
                    context.ProtectiveStopOrderRef = e.Order.OrderId;
                    if (CanAdjustProtectiveOrder(e.Order) && context.AdjustedOrders.TryAdd(e.Order.OrderId, true) && context.Command.ProtectiveStop.HasValue)
                    {
                        e.Order.StopPriceChanged = context.Command.ProtectiveStop.Value;
                        simAccount.Change(new[] { e.Order });
                    }
                }
                else if (e.Order.OrderType == OrderType.Limit)
                {
                    context.ProfitTargetOrderRef = e.Order.OrderId;
                    if (CanAdjustProtectiveOrder(e.Order) && context.AdjustedOrders.TryAdd(e.Order.OrderId, true) && context.Command.ProfitTarget.HasValue)
                    {
                        e.Order.LimitPriceChanged = context.Command.ProfitTarget.Value;
                        simAccount.Change(new[] { e.Order });
                    }
                }
            }
            Dictionary<string, object> payload = OrderPayload(e.Order);
            bool brokerError = e.Error != ErrorCode.NoError;
            payload["error_code"] = e.Error.ToString();
            payload["error_message"] = e.Comment ?? string.Empty;
            if (brokerError)
            {
                payload["status"] = "Rejected";
                payload["order_state"] = "Rejected";
            }
            AddonEvent item = NewEvent("order", payload, managed ? context.Command : null);
            bool moveConfirmed = managed && context.Command.Action == "move_stop"
                && !brokerError && context.Command.StopPrice.HasValue
                && (e.Order.OrderState == OrderState.Accepted || e.Order.OrderState == OrderState.Working)
                && Math.Abs(e.Order.StopPrice - context.Command.StopPrice.Value) < 0.0000001;
            bool directLifecycle = managed && (context.Command.Action == "move_stop"
                ? brokerError || moveConfirmed
                : context.Command.Action != "place_entry" || IsCommandOrder(e.Order, context.Command));
            item.Payload["desk_lifecycle"] = directLifecycle;
            if (managed && context != null && !IsCommandOrder(e.Order, context.Command))
                item.Payload["order_role"] = (e.Order.OrderType == OrderType.StopMarket || e.Order.OrderType == OrderType.StopLimit) ? "protective_stop" : "profit_target";
            if (managed && context != null && !string.IsNullOrEmpty(context.ProtectiveStopOrderRef)) item.Payload["protective_stop_order_ref"] = context.ProtectiveStopOrderRef;
            if (managed && context != null && !string.IsNullOrEmpty(context.ProfitTargetOrderRef)) item.Payload["profit_target_order_ref"] = context.ProfitTargetOrderRef;
            pendingEvents.Enqueue(item);
        }

        private void OnExecutionUpdate(object sender, ExecutionEventArgs e)
        {
            CommandContext context = null;
            if (e.Execution.Order != null) deskOrders.TryGetValue(e.Execution.Order, out context);
            if (context != null && context.Command.Action == "place_entry") context.EntryFilled = true;
            Dictionary<string, object> payload = new Dictionary<string, object>
            {
                { "execution_id", e.Execution.ExecutionId }, { "broker_order_ref", e.Execution.OrderId },
                { "quantity", e.Execution.Quantity }, { "price", e.Execution.Price }, { "market_position", e.Execution.MarketPosition.ToString().ToUpperInvariant() }
            };
            pendingEvents.Enqueue(NewEvent("execution", payload, context == null ? null : context.Command));
        }

        private void OnPositionUpdate(object sender, PositionEventArgs e)
        {
            if (e.Position.Quantity == 0)
            {
                CommandContext removed;
                activeInstrumentContexts.TryRemove(e.Position.Instrument.FullName, out removed);
                pendingCloseContexts.TryRemove(e.Position.Instrument.FullName, out removed);
            }
            else ResizeActiveProtection(e.Position);
            pendingEvents.Enqueue(NewEvent("position", PositionPayload(e.Position), null));
        }

        private void ResizeActiveProtection(Position position)
        {
            CommandContext context;
            if (!activeInstrumentContexts.TryGetValue(position.Instrument.FullName, out context) || context == null) return;
            List<Order> changes = new List<Order>();
            lock (simAccount.Orders)
            {
                foreach (Order order in simAccount.Orders)
                {
                    bool isTrackedProtection = string.Equals(order.OrderId, context.ProtectiveStopOrderRef, StringComparison.Ordinal)
                        || string.Equals(order.OrderId, context.ProfitTargetOrderRef, StringComparison.Ordinal);
                    if (!isTrackedProtection || !CanAdjustProtectiveOrder(order) || order.Quantity == position.Quantity) continue;
                    order.QuantityChanged = position.Quantity;
                    order.LimitPriceChanged = order.LimitPrice;
                    order.StopPriceChanged = order.StopPrice;
                    changes.Add(order);
                }
            }
            if (changes.Count > 0) simAccount.Change(changes);
        }

        private void OnAccountItemUpdate(object sender, AccountItemEventArgs e)
        {
            pendingEvents.Enqueue(NewEvent("account", new Dictionary<string, object>
            {
                { "account_item", e.AccountItem.ToString() }, { "currency", e.Currency.ToString() }, { "value", e.Value }
            }, null));
        }

        private AddonEvent NewEvent(string type, Dictionary<string, object> payload, AddonCommand command)
        {
            string occurredAt = Utc(DateTime.UtcNow);
            string seed = type + "|" + occurredAt + "|" + Guid.NewGuid().ToString("N");
            return new AddonEvent
            {
                EventId = "addon_event_" + Sha256(seed).Substring(0, 32), EventType = type, OccurredAt = occurredAt,
                ExternalEventKey = Sha256(bridgeId + "|" + seed), Payload = payload,
                IntentId = command == null ? null : command.IntentId,
                ManagementIntentId = command == null ? null : command.ManagementIntentId,
                CommandId = command == null ? null : command.CommandId
            };
        }

        private void QueueCommandEvent(AddonCommand command, string status, string error)
        {
            pendingEvents.Enqueue(NewEvent("command", new Dictionary<string, object>
            {
                { "status", status }, { "error", error ?? string.Empty }, { "action", command.Action }
            }, command));
        }

        private void LoadCommandJournal()
        {
            try
            {
                string directory = Path.GetDirectoryName(commandJournalPath);
                if (!Directory.Exists(directory)) Directory.CreateDirectory(directory);
                if (!File.Exists(commandJournalPath)) return;
                foreach (string line in File.ReadAllLines(commandJournalPath))
                {
                    string commandId = (line ?? string.Empty).Trim();
                    if (commandId.Length > 0) processedCommands.TryAdd(commandId, 0);
                }
            }
            catch (Exception error)
            {
                Print("DeskExecutionAddOn command journal load error: " + error.Message);
            }
        }

        private bool IsCommandAlreadyApplied(AddonCommand command)
        {
            if (command == null || string.IsNullOrWhiteSpace(command.CommandId)) throw new InvalidOperationException("COMMAND_ID_REQUIRED");
            if (processedCommands.ContainsKey(command.CommandId)) return true;
            string expectedOrderName = CommandOrderName(command);
            lock (simAccount.Orders)
                return simAccount.Orders.Any(order => string.Equals(order.Name, expectedOrderName, StringComparison.Ordinal));
        }

        private void MarkCommandProcessed(string commandId)
        {
            if (!processedCommands.TryAdd(commandId, 0)) return;
            lock (commandJournalLock)
            {
                string directory = Path.GetDirectoryName(commandJournalPath);
                if (!Directory.Exists(directory)) Directory.CreateDirectory(directory);
                File.AppendAllText(commandJournalPath, commandId + Environment.NewLine, Encoding.UTF8);
            }
        }

        private static string CommandOrderName(AddonCommand command)
        {
            string suffix = Sanitize(command == null ? string.Empty : command.CommandId);
            if (suffix.Length > 24) suffix = suffix.Substring(suffix.Length - 24);
            return "Desk_" + suffix;
        }

        private static bool IsCommandOrder(Order order, AddonCommand command)
        {
            return order != null && string.Equals(order.Name, CommandOrderName(command), StringComparison.Ordinal);
        }

        private async Task<TResponse> PostAsync<TRequest, TResponse>(string path, TRequest payload, CancellationToken token)
        {
            string body = Serialize(payload);
            string timestamp = DateTimeOffset.UtcNow.ToUnixTimeMilliseconds().ToString();
            string nonce = Guid.NewGuid().ToString("N");
            string signature = Sign(timestamp, nonce, "POST", "/api/v1" + path, body);
            using (HttpRequestMessage request = new HttpRequestMessage(HttpMethod.Post, apiBaseUrl + path))
            {
                request.Content = new StringContent(body, Encoding.UTF8, "application/json");
                request.Headers.Add("X-Desk-Addon-Id", bridgeId);
                request.Headers.Add("X-Desk-Addon-Timestamp", timestamp);
                request.Headers.Add("X-Desk-Addon-Nonce", nonce);
                request.Headers.Add("X-Desk-Addon-Signature", signature);
                using (HttpResponseMessage response = await http.SendAsync(request, token).ConfigureAwait(false))
                {
                    string responseBody = await response.Content.ReadAsStringAsync().ConfigureAwait(false);
                    if (!response.IsSuccessStatusCode) throw new InvalidOperationException("API " + (int)response.StatusCode + ": " + responseBody);
                    return Deserialize<TResponse>(responseBody);
                }
            }
        }

        private string Sign(string timestamp, string nonce, string method, string pathname, string body)
        {
            string canonical = timestamp + "\n" + nonce + "\n" + method + "\n" + pathname + "\n" + Sha256(body);
            using (HMACSHA256 hmac = new HMACSHA256(Encoding.UTF8.GetBytes(sharedSecret)))
                return Hex(hmac.ComputeHash(Encoding.UTF8.GetBytes(canonical)));
        }

        private bool IsConnected() { return simAccount != null && simAccount.Connection != null && simAccount.Connection.Status == ConnectionStatus.Connected; }
        private string ConnectionStatusText() { return simAccount == null || simAccount.Connection == null ? "Disconnected" : simAccount.Connection.Status.ToString(); }
        private string PriceStatusText() { return simAccount == null || simAccount.Connection == null ? "Disconnected" : simAccount.Connection.PriceStatus.ToString(); }
        private Dictionary<string, object> ConnectionPayload()
        {
            Dictionary<string, object> payload = new Dictionary<string, object>
            {
                { "status", ConnectionStatusText() },
                { "price_status", PriceStatusText() }
            };
            try
            {
                if (simAccount != null && simAccount.Connection != null && simAccount.Connection.Options != null)
                {
                    payload["name"] = simAccount.Connection.Options.Name;
                    payload["provider"] = simAccount.Connection.Options.Provider.ToString();
                    payload["mode"] = simAccount.Connection.Options.Mode.ToString();
                    payload["is_demo"] = simAccount.Connection.Options.IsDemo;
                    payload["brand_name"] = simAccount.Connection.Options.BrandName;
                }
            }
            catch { }
            return payload;
        }
        private double SafeAccountValue(AccountItem item) { try { return simAccount.Get(item, Currency.UsDollar); } catch { return 0; } }
        private static bool IsProtectiveOrder(Order order) { return order != null && order.Name != "Entry" && (order.OrderType == OrderType.StopMarket || order.OrderType == OrderType.StopLimit || order.OrderType == OrderType.Limit); }
        private static bool IsCloseMarketOrder(Order order, string side)
        {
            if (order == null || order.OrderType != OrderType.Market) return false;
            return side == "SELL"
                ? order.OrderAction == OrderAction.Sell || order.OrderAction == OrderAction.SellShort
                : order.OrderAction == OrderAction.Buy || order.OrderAction == OrderAction.BuyToCover;
        }
        private static bool CanAdjustProtectiveOrder(Order order) { return order != null && (order.OrderState == OrderState.Accepted || order.OrderState == OrderState.Working); }
        private static bool IsSimulationAccount(string value) { return !string.IsNullOrWhiteSpace(value) && value.StartsWith("Sim", StringComparison.OrdinalIgnoreCase) && value.Skip(3).All(char.IsDigit); }
        private string Env(string name, string fallback)
        {
            string value = Environment.GetEnvironmentVariable(name);
            if (!string.IsNullOrWhiteSpace(value)) return value.Trim();

            string configPath = Environment.GetEnvironmentVariable("DESK_NINJA_DESK_ENV_FILE");
            if (string.IsNullOrWhiteSpace(configPath))
                configPath = @"C:\ProgramData\DeskFutures\config\desk.env";
            try
            {
                if (File.Exists(configPath))
                {
                    string prefix = name + "=";
                    foreach (string rawLine in File.ReadAllLines(configPath))
                    {
                        string line = rawLine == null ? string.Empty : rawLine.Trim();
                        if (!line.StartsWith(prefix, StringComparison.Ordinal)) continue;
                        string configured = line.Substring(prefix.Length).Trim();
                        if (configured.Length >= 2 && configured[0] == '"' && configured[configured.Length - 1] == '"')
                            configured = configured.Substring(1, configured.Length - 2);
                        if (!string.IsNullOrWhiteSpace(configured)) return configured;
                    }
                }
            }
            catch (Exception error)
            {
                Print("DeskExecutionAddOn config fallback error for " + name + ": " + error.Message);
            }
            return fallback;
        }
        private static string LimitName(string value) { string clean = Sanitize(value); return clean.Length <= 50 ? clean : clean.Substring(0, 50); }
        private static string Sanitize(string value) { return new string((value ?? string.Empty).Select(c => char.IsLetterOrDigit(c) || c == '_' || c == '-' ? c : '_').ToArray()); }
        private static string Utc(DateTime value) { return value.ToUniversalTime().ToString("yyyy-MM-dd'T'HH:mm:ss.fff'Z'"); }
        private static string Sha256(string value) { using (SHA256 sha = SHA256.Create()) return Hex(sha.ComputeHash(Encoding.UTF8.GetBytes(value ?? string.Empty))); }
        private static string Hex(byte[] bytes) { return BitConverter.ToString(bytes).Replace("-", string.Empty).ToLowerInvariant(); }
        private static OrderType ToOrderType(string value) { if (value == "MARKET") return OrderType.Market; if (value == "LIMIT") return OrderType.Limit; if (value == "STOP_MARKET") return OrderType.StopMarket; if (value == "STOP_LIMIT") return OrderType.StopLimit; throw new InvalidOperationException("ORDER_TYPE_INVALID"); }
        private static TimeInForce ToTimeInForce(string value) { return value == "GTC" ? TimeInForce.Gtc : TimeInForce.Day; }

        private static Dictionary<string, object> OrderPayload(Order order)
        {
            return new Dictionary<string, object>
            {
                { "broker_order_ref", order.OrderId }, { "order_id", order.OrderId }, { "name", order.Name },
                { "instrument", order.Instrument.FullName }, { "status", order.OrderState.ToString() },
                { "order_state", order.OrderState.ToString() }, { "side", order.OrderAction.ToString() },
                { "order_type", order.OrderType.ToString() }, { "quantity", order.Quantity }, { "filled_quantity", order.Filled },
                { "average_fill_price", order.AverageFillPrice }, { "remaining_quantity", Math.Max(0, order.Quantity - order.Filled) },
                { "limit_price", order.LimitPrice }, { "stop_price", order.StopPrice }, { "occurred_at", Utc(order.Time) }, { "oco", order.Oco ?? string.Empty }
            };
        }

        private static Dictionary<string, object> PositionPayload(Position position)
        {
            object markPrice = null;
            object markTime = null;
            try
            {
                var last = position.Instrument.MarketData.Last;
                if (last != null && last.Price > 0)
                {
                    markPrice = last.Price;
                    markTime = Utc(last.Time);
                }
            }
            catch { }
            return new Dictionary<string, object>
            {
                { "instrument", position.Instrument.FullName }, { "market_position", position.MarketPosition.ToString().ToUpperInvariant() },
                { "side", position.MarketPosition.ToString().ToUpperInvariant() }, { "quantity", position.Quantity }, { "average_price", position.AveragePrice },
                { "mark_price", markPrice }, { "mark_time", markTime }
            };
        }

        private static string Serialize<T>(T value)
        {
            return CreateJsonSerializer().Serialize(value);
        }
        private static T Deserialize<T>(string value)
        {
            return CreateJsonSerializer().Deserialize<T>(value ?? string.Empty);
        }
        private static JavaScriptSerializer CreateJsonSerializer()
        {
            JavaScriptSerializer serializer = new JavaScriptSerializer
            {
                MaxJsonLength = 2 * 1024 * 1024,
                RecursionLimit = 64
            };
            serializer.RegisterConverters(new JavaScriptConverter[] { new DeskJsonConverter() });
            return serializer;
        }
    }

    internal sealed class CommandContext
    {
        internal CommandContext(AddonCommand command) { Command = command; AdjustedOrders = new ConcurrentDictionary<string, bool>(); }
        internal AddonCommand Command { get; private set; }
        internal bool EntryFilled { get; set; }
        internal string ProtectiveStopOrderRef { get; set; }
        internal string ProfitTargetOrderRef { get; set; }
        internal ConcurrentDictionary<string, bool> AdjustedOrders { get; private set; }
    }

    [AttributeUsage(AttributeTargets.Field)]
    internal sealed class DeskJsonFieldAttribute : Attribute
    {
        internal DeskJsonFieldAttribute(string name) { Name = name; EmitDefaultValue = true; }
        public string Name { get; private set; }
        public bool EmitDefaultValue { get; set; }
    }

    internal sealed class DeskJsonConverter : JavaScriptConverter
    {
        private static readonly Type[] ContractTypes =
        {
            typeof(HeartbeatRequest), typeof(HeartbeatResponse), typeof(ClaimRequest), typeof(ClaimResponse),
            typeof(AddonWork), typeof(AddonCommand), typeof(CompleteRequest), typeof(CompleteResponse),
            typeof(EventBatchRequest), typeof(EventBatchResponse), typeof(AddonEvent), typeof(SnapshotRequest),
            typeof(AddonSnapshot), typeof(SnapshotResponse)
        };

        public override IEnumerable<Type> SupportedTypes { get { return ContractTypes; } }

        public override IDictionary<string, object> Serialize(object value, JavaScriptSerializer serializer)
        {
            Dictionary<string, object> payload = new Dictionary<string, object>(StringComparer.Ordinal);
            if (value == null) return payload;
            foreach (FieldInfo field in value.GetType().GetFields(BindingFlags.Instance | BindingFlags.Public))
            {
                DeskJsonFieldAttribute jsonField = field.GetCustomAttributes(typeof(DeskJsonFieldAttribute), false)
                    .Cast<DeskJsonFieldAttribute>()
                    .FirstOrDefault();
                if (jsonField == null) continue;
                object fieldValue = field.GetValue(value);
                if (!jsonField.EmitDefaultValue && IsDefaultValue(fieldValue, field.FieldType)) continue;
                payload[jsonField.Name] = fieldValue;
            }
            return payload;
        }

        public override object Deserialize(IDictionary<string, object> dictionary, Type type, JavaScriptSerializer serializer)
        {
            object instance = Activator.CreateInstance(type, true);
            foreach (FieldInfo field in type.GetFields(BindingFlags.Instance | BindingFlags.Public))
            {
                DeskJsonFieldAttribute jsonField = field.GetCustomAttributes(typeof(DeskJsonFieldAttribute), false)
                    .Cast<DeskJsonFieldAttribute>()
                    .FirstOrDefault();
                object raw;
                if (jsonField == null || !dictionary.TryGetValue(jsonField.Name, out raw)) continue;
                field.SetValue(instance, ConvertJsonValue(raw, field.FieldType, serializer));
            }
            return instance;
        }

        private static object ConvertJsonValue(object value, Type targetType, JavaScriptSerializer serializer)
        {
            if (value == null) return null;
            Type nullableType = Nullable.GetUnderlyingType(targetType);
            if (nullableType != null) return ConvertJsonValue(value, nullableType, serializer);
            if (targetType.IsInstanceOfType(value)) return value;
            if (targetType == typeof(string)) return Convert.ToString(value, CultureInfo.InvariantCulture);
            if (targetType == typeof(bool)) return Convert.ToBoolean(value, CultureInfo.InvariantCulture);
            if (targetType == typeof(int)) return Convert.ToInt32(value, CultureInfo.InvariantCulture);
            if (targetType == typeof(double)) return Convert.ToDouble(value, CultureInfo.InvariantCulture);
            if (targetType.IsEnum) return Enum.Parse(targetType, Convert.ToString(value, CultureInfo.InvariantCulture), true);

            if (targetType.IsGenericType && targetType.GetGenericTypeDefinition() == typeof(List<>))
            {
                Type itemType = targetType.GetGenericArguments()[0];
                IList list = (IList)Activator.CreateInstance(targetType);
                IEnumerable values = value as IEnumerable;
                if (values != null)
                    foreach (object item in values) list.Add(ConvertJsonValue(item, itemType, serializer));
                return list;
            }

            IDictionary<string, object> nested = value as IDictionary<string, object>;
            if (nested != null && ContractTypes.Contains(targetType))
                return new DeskJsonConverter().Deserialize(nested, targetType, serializer);
            return value;
        }

        private static bool IsDefaultValue(object value, Type type)
        {
            if (value == null) return true;
            if (!type.IsValueType) return false;
            return value.Equals(Activator.CreateInstance(type));
        }
    }

    internal sealed class HeartbeatRequest {
        [DeskJsonField("bridgeId")] public string BridgeId; [DeskJsonField("brokerAccountId")] public string BrokerAccountId;
        [DeskJsonField("mode")] public string Mode; [DeskJsonField("status")] public string Status; [DeskJsonField("hostName")] public string HostName;
        [DeskJsonField("processId")] public int ProcessId; [DeskJsonField("ninjaConnected")] public bool NinjaConnected;
        [DeskJsonField("commandEnabled")] public bool CommandEnabled; [DeskJsonField("accountName")] public string AccountName;
        [DeskJsonField("protocolVersion")] public string ProtocolVersion; [DeskJsonField("capabilities")] public Dictionary<string, object> Capabilities;
    }
    internal sealed class HeartbeatResponse { [DeskJsonField("contract")] public string Contract; }
    internal sealed class ClaimRequest {
        [DeskJsonField("bridgeId")] public string BridgeId; [DeskJsonField("brokerAccountId")] public string BrokerAccountId;
        [DeskJsonField("accountName")] public string AccountName; [DeskJsonField("leaseSeconds")] public int LeaseSeconds;
    }
    internal sealed class ClaimResponse { [DeskJsonField("status")] public string Status; [DeskJsonField("reason")] public string Reason; [DeskJsonField("work")] public AddonWork Work; }
    internal sealed class AddonWork {
        [DeskJsonField("outbox_id")] public string OutboxId; [DeskJsonField("work_type")] public string WorkType;
        [DeskJsonField("lease_token")] public string LeaseToken; [DeskJsonField("command")] public AddonCommand Command;
    }
    internal sealed class AddonCommand {
        [DeskJsonField("schema_version")] public string SchemaVersion; [DeskJsonField("command_id")] public string CommandId;
        [DeskJsonField("work_type")] public string WorkType; [DeskJsonField("action")] public string Action; [DeskJsonField("account_name")] public string AccountName;
        [DeskJsonField("intent_id")] public string IntentId; [DeskJsonField("management_intent_id")] public string ManagementIntentId;
        [DeskJsonField("instrument")] public string Instrument; [DeskJsonField("side")] public string Side; [DeskJsonField("quantity")] public int Quantity;
        [DeskJsonField("order_type")] public string OrderType; [DeskJsonField("limit_price")] public double? LimitPrice; [DeskJsonField("stop_price")] public double? StopPrice;
        [DeskJsonField("time_in_force")] public string TimeInForce; [DeskJsonField("protective_stop")] public double? ProtectiveStop;
        [DeskJsonField("profit_target")] public double? ProfitTarget; [DeskJsonField("atm_strategy_name")] public string AtmStrategyName;
        [DeskJsonField("atm_strategy_id")] public string AtmStrategyId; [DeskJsonField("broker_order_ref")] public string BrokerOrderRef;
        [DeskJsonField("issued_at")] public string IssuedAt; [DeskJsonField("expires_at")] public string ExpiresAt;
    }
    internal sealed class CompleteRequest {
        [DeskJsonField("bridgeId")] public string BridgeId; [DeskJsonField("outboxId")] public string OutboxId;
        [DeskJsonField("leaseToken")] public string LeaseToken; [DeskJsonField("workType")] public string WorkType;
        [DeskJsonField("status")] public string Status; [DeskJsonField("renderedCommand")] public string RenderedCommand; [DeskJsonField("error")] public string Error;
    }
    internal sealed class CompleteResponse { [DeskJsonField("contract")] public string Contract; }
    internal sealed class EventBatchRequest {
        [DeskJsonField("bridgeId")] public string BridgeId; [DeskJsonField("brokerAccountId")] public string BrokerAccountId; [DeskJsonField("events")] public List<AddonEvent> Events;
    }
    internal sealed class EventBatchResponse { [DeskJsonField("count")] public int Count; }
    internal sealed class AddonEvent {
        [DeskJsonField("event_id")] public string EventId; [DeskJsonField("event_type")] public string EventType;
        [DeskJsonField("occurred_at")] public string OccurredAt; [DeskJsonField("intent_id", EmitDefaultValue=false)] public string IntentId;
        [DeskJsonField("management_intent_id", EmitDefaultValue=false)] public string ManagementIntentId; [DeskJsonField("command_id", EmitDefaultValue=false)] public string CommandId;
        [DeskJsonField("external_event_key")] public string ExternalEventKey; [DeskJsonField("payload")] public Dictionary<string, object> Payload;
    }
    internal sealed class SnapshotRequest {
        [DeskJsonField("bridgeId")] public string BridgeId; [DeskJsonField("brokerAccountId")] public string BrokerAccountId;
        [DeskJsonField("reconcile")] public bool Reconcile; [DeskJsonField("lockOnDivergence")] public bool LockOnDivergence; [DeskJsonField("snapshot")] public AddonSnapshot Snapshot;
    }
    internal sealed class AddonSnapshot {
        [DeskJsonField("captured_at")] public string CapturedAt; [DeskJsonField("connection")] public Dictionary<string, object> Connection;
        [DeskJsonField("account")] public Dictionary<string, object> Account; [DeskJsonField("orders")] public List<Dictionary<string, object>> Orders;
        [DeskJsonField("positions")] public List<Dictionary<string, object>> Positions;
    }
    internal sealed class SnapshotResponse { [DeskJsonField("contract")] public string Contract; }
}
