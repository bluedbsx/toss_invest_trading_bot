const $ = (selector) => document.querySelector(selector);
// 부동소수점 매매로 남는 미세 잔량/잔액을 보유로 표시하지 않기 위한 기준값(서버 POSITION_DUST_EPSILON과 동일).
const DUST_EPSILON = 1e-6;
const targetGrid = $("#targetGrid");
const targetEditor = $("#targetEditor");
const progressHost = createProgressHost();
let progressHideTimer = null;
let lastActionRequestPreview = null;
let state = null;

await refresh();
setInterval(refresh, 20_000);

$("#saveSettings").addEventListener("click", saveSettings);
$("#runOnce").addEventListener("click", () => runTossAction("runOnce", "/api/run-once", $("#runOnce")));
$("#syncNews").addEventListener("click", (event) => {
  event.stopPropagation();
  post("/api/sync-news").then(refresh);
});
$("#syncOrders").addEventListener("click", () => runTossAction("syncOrders", "/api/sync-orders", $("#syncOrders")));
$("#addBotBudget").addEventListener("click", addBotBudget);
$("#refreshLearningReport").addEventListener("click", refreshLearningReport);
$("#saveAutomation").addEventListener("click", saveAutomationSettings);
$("#runAutomationNow").addEventListener("click", runAutomationNow);
$("#recommendSafety").addEventListener("click", recommendSafetySettings);
$("#copyPublicIp").addEventListener("click", copyPublicIp);
$("#copyMobileUrl").addEventListener("click", copyMobileUrl);
$("#refreshPublicIp").addEventListener("click", refreshPublicIp);
$("#testConnection").addEventListener("click", async () => {
  const result = await runTossAction("testConnection", "/api/test-connection", $("#testConnection"), { refreshAfter: false });
  if (result) {
    if (result.ok) {
      alert(result.mockMode ? "연습 데이터 모드입니다." : `토스 API 연결 성공: 계좌 ${result.accounts.length}개`);
    } else {
      alert(`토스 API 연결 실패: ${humanError(result.error)}`);
    }
  }
  await refresh();
});
$("#monitoringEnabled").addEventListener("change", (event) => {
  post("/api/engine/toggle", { enabled: event.target.checked }).then(refresh);
});
$("#allowFractional").addEventListener("change", () => renderTradingSessionControls());
$("#useVirtualSeed").addEventListener("change", () => {
  const useSeedBook = $("#useVirtualSeed").checked;
  $("#allowSeedTopUp").disabled = !useSeedBook;
  $("#virtualSeedLabel").textContent = useSeedBook ? "사용" : "고정한도";
  $("#seedTopUpLabel").textContent = useSeedBook && $("#allowSeedTopUp").checked ? "허용" : "꺼짐";
});
$("#addTarget").addEventListener("click", async () => {
  const symbol = prompt("추가할 미국 주식/ETF 티커를 입력하세요. 예: AAPL");
  if (!symbol) return;
  await post("/api/targets", { symbol, allocationPct: 10 });
  await refresh();
});
$("#recommendWeights").addEventListener("click", async () => {
  const button = $("#recommendWeights");
  try {
    setButtonBusy(button, true, "계산 중");
    const monitorNote = state?.settings?.monitoringEnabled
      ? "자동 모니터링이 켜져 있어도 이 추천 계산은 Toss API를 호출하지 않습니다."
      : "이 추천 계산은 Toss API를 호출하지 않습니다.";
    showProgress("전체비중 추천 계산 중", `외부 일봉 데이터와 1시간 캐시만 사용합니다. ${monitorNote}`);
    const recommendation = await get("/api/recommendations/weights");
    const preview = Object.entries(recommendation.weights)
      .map(([symbol, weight]) => `${symbol} ${weight}%`)
      .join(", ");
    const scoreLine = recommendation.score !== undefined ? `\n백테스트 반영 점수: ${recommendation.score}/100 · ${recommendation.grade}` : "";
    const warning =
      recommendation.score !== undefined && recommendation.score < 65
        ? "\n\n점수가 낮습니다. 전략 재검토 또는 소액 테스트가 더 안전합니다."
        : "";
    const cacheText = recommendation.cache?.hit ? `캐시 사용 · 약 ${recommendation.cache.ttlMinutes}분 남음` : "새 외부 데이터로 계산 완료";
    showProgress("전체비중 계산 완료", `${cacheText}. 추천값 적용 여부를 확인하고 있습니다.`, "success");
    if (!confirm(`전체 비중 추천값을 적용할까요?\n${preview}${scoreLine}${warning}`)) {
      showProgress("전체비중 추천 취소", "계산은 완료됐지만 설정에 적용하지 않았습니다.", "neutral");
      return;
    }
    showProgress("전체비중 저장 중", "추천 비중을 종목 설정에 저장하고 있습니다.");
    state = await post("/api/recommendations/weights/apply");
    renderWeightRecommendationNote(state.lastWeightRecommendation);
    await refresh();
    showProgress("전체비중 추천 적용 완료", "새 비중이 저장됐습니다.", "success");
  } catch (error) {
    showProgress("전체비중 추천 실패", humanError(error.message), "danger");
  } finally {
    setButtonBusy(button, false);
  }
});

async function refresh() {
  state = await get("/api/state");
  renderBeginnerHero();
  renderSettings();
  renderTargets();
  renderAccount();
  renderValidation();
  renderSignals();
  renderTrades();
  renderNews();
  renderStrategy();
  renderLearning();
  renderAutomation();
  renderEditor();
  renderRateLimits();
  renderWeightRecommendationNote(state.lastWeightRecommendation);
  renderSafetyRecommendationNote(state.lastSafetyRecommendation);
}

async function saveAutomationSettings() {
  const button = $("#saveAutomation");
  try {
    setButtonBusy(button, true, "저장 중");
    await patch("/api/settings", readAutomationForm());
    await refresh();
    showProgress("자가판단 설정 저장 완료", "자동화 스위치와 검토 주기를 저장했습니다.", "success");
  } catch (error) {
    showProgress("자가판단 설정 저장 실패", humanError(error.message), "danger");
  } finally {
    setButtonBusy(button, false);
  }
}

async function runAutomationNow() {
  const button = $("#runAutomationNow");
  try {
    setButtonBusy(button, true, "실행 중");
    showProgress("봇 자가판단 실행 중", "켜진 자동화 기능만 한 번씩 실행합니다. 보유 중인 종목 전략은 적용하지 않고 보류합니다.");
    const result = await post("/api/automation/run");
    state = preserveRuntimeState(result.state ?? state);
    renderAutomation();
    await refresh();
    showProgress("봇 자가판단 완료", (result.actions ?? []).map((item) => item.message).join(" · ") || "자동화할 항목이 없었습니다.", "success");
  } catch (error) {
    showProgress("봇 자가판단 실패", humanError(error.message), "danger");
  } finally {
    setButtonBusy(button, false);
  }
}

async function refreshLearningReport() {
  const button = $("#refreshLearningReport");
  try {
    setButtonBusy(button, true, "분석 중");
    showProgress("개선 리포트 갱신 중", "저장된 매매 판단, 주문 이력, 추천 계산 기록을 분석합니다.");
    const report = await post("/api/learning/report");
    state.learning = {
      ...(state.learning ?? {}),
      lastReport: report,
      reports: [report, ...((state.learning?.reports ?? []).filter((item) => item.id !== report.id))]
    };
    renderLearning();
    showProgress("개선 리포트 갱신 완료", "전략 버전업에 쓸 데이터 요약을 새로 만들었습니다.", "success");
  } catch (error) {
    showProgress("개선 리포트 갱신 실패", humanError(error.message), "danger");
  } finally {
    setButtonBusy(button, false);
  }
}

async function recommendSafetySettings() {
  const button = $("#recommendSafety");
  try {
    setButtonBusy(button, true, "계산 중");
    showProgress("안전설정 추천 계산 중", "자동투자 금액은 유지하고, 활성 종목 점수·비중·레버리지·변동성을 보고 방어 설정을 계산합니다.");
    const currentSettings = readSettingsForm();
    const recommendation = await post("/api/recommendations/safety", { settings: currentSettings });
    applySafetyInputs(recommendation.recommended);
    const summary = renderSafetyRecommendationText(recommendation);
    if (!confirm(`안전설정 추천값을 저장할까요?\n${summary}`)) {
      renderSafetyRecommendationNote({ ...recommendation, appliedAt: null, canceled: true });
      showProgress("안전설정 추천 취소", "추천값은 입력칸에만 반영했고 저장하지 않았습니다.", "neutral");
      return;
    }
    showProgress("안전설정 저장 중", "추천된 안전설정을 저장하고 있습니다.");
    await post("/api/recommendations/safety/apply", { settings: readSettingsForm() });
    await refresh();
    showProgress("안전설정 저장 완료", "추천 안전설정이 저장됐습니다.", "success");
  } catch (error) {
    showProgress("안전설정 추천 실패", humanError(error.message), "danger");
  } finally {
    setButtonBusy(button, false);
  }
}

async function addBotBudget() {
  const input = $("#botBudgetAddAmount");
  const button = $("#addBotBudget");
  const amountUsd = Number(input.value);
  if (!Number.isFinite(amountUsd) || amountUsd <= 0) {
    showProgress("봇 자금 추가 실패", "추가할 금액을 0보다 크게 입력하세요.", "danger");
    return;
  }
  const currentSeed = Number(state?.settings?.allocationUsd ?? 0);
  const nextSeed = currentSeed + amountUsd;
  if (!confirm(`봇 자금을 ${money(amountUsd)} 추가할까요?\n시작 시드가 ${money(currentSeed)} → ${money(nextSeed)}로 바뀝니다.\n원금 보충 허용은 계속 꺼진 상태로 유지됩니다.`)) {
    showProgress("봇 자금 추가 취소", "설정은 변경하지 않았습니다.", "neutral");
    return;
  }
  try {
    setButtonBusy(button, true, "추가 중");
    showProgress("봇 자금 추가 중", "시작 시드를 올리고 변경 기록을 남깁니다.");
    state = await post("/api/bot-budget/add", { amountUsd });
    input.value = "";
    await refresh();
    showProgress("봇 자금 추가 완료", `봇 시작 시드를 ${money(state.settings.allocationUsd)}로 변경했습니다.`, "success");
  } catch (error) {
    showProgress("봇 자금 추가 실패", humanError(error.message), "danger");
  } finally {
    setButtonBusy(button, false);
  }
}

function applySafetyInputs(values) {
  if (!values) return;
  if (values.useVirtualSeed !== undefined) $("#useVirtualSeed").checked = Boolean(values.useVirtualSeed);
  if (values.allowSeedTopUp !== undefined) $("#allowSeedTopUp").checked = Boolean(values.allowSeedTopUp);
  if (values.cashBufferUsd !== undefined) $("#cashBufferUsd").value = values.cashBufferUsd;
  if (values.maxDailyLossPct !== undefined) $("#maxDailyLossPct").value = values.maxDailyLossPct;
  if (values.maxPositionPct !== undefined) $("#maxPositionPct").value = values.maxPositionPct;
  if (values.maxLeveragedExposurePct !== undefined) $("#maxLeveragedExposurePct").value = values.maxLeveragedExposurePct;
  if (values.intradayDropBlockPct !== undefined) $("#intradayDropBlockPct").value = values.intradayDropBlockPct;
  if (values.intradayPanicExitPct !== undefined) $("#intradayPanicExitPct").value = values.intradayPanicExitPct;
  if (values.additionalBuyCooldownMinutes !== undefined) $("#additionalBuyCooldownMinutes").value = values.additionalBuyCooldownMinutes;
  if (values.allowAdditionalBuys !== undefined) $("#allowAdditionalBuys").checked = Boolean(values.allowAdditionalBuys);
  $("#allowSeedTopUp").disabled = !$("#useVirtualSeed").checked;
  $("#virtualSeedLabel").textContent = $("#useVirtualSeed").checked ? "사용" : "고정한도";
  $("#seedTopUpLabel").textContent = $("#allowSeedTopUp").checked && $("#useVirtualSeed").checked ? "허용" : "꺼짐";
  $("#additionalBuyLabel").textContent = $("#allowAdditionalBuys").checked ? "켜짐" : "꺼짐";
}

function createProgressHost() {
  const host = document.createElement("div");
  host.className = "progress-toast neutral";
  host.hidden = true;
  host.innerHTML = `
    <div class="spinner"></div>
    <div>
      <strong data-role="progress-title"></strong>
      <p data-role="progress-detail"></p>
    </div>
  `;
  document.body.append(host);
  return host;
}

function showProgress(title, detail, kind = "neutral") {
  if (progressHideTimer) {
    clearTimeout(progressHideTimer);
    progressHideTimer = null;
  }
  progressHost.hidden = false;
  progressHost.className = `progress-toast ${kind}`;
  progressHost.querySelector('[data-role="progress-title"]').textContent = title;
  progressHost.querySelector('[data-role="progress-detail"]').textContent = detail;
  if (["success", "danger"].includes(kind) || title.includes("완료") || title.includes("취소") || title.includes("실패")) {
    progressHideTimer = setTimeout(() => {
      progressHost.hidden = true;
      progressHideTimer = null;
    }, kind === "danger" ? 6500 : 3500);
  }
}

function setButtonBusy(button, busy, label = "처리 중") {
  if (!button) return;
  if (busy) {
    button.dataset.originalText = button.textContent;
    button.disabled = true;
    button.classList.add("is-busy");
    button.innerHTML = `<span class="spinner small"></span>${escapeHtml(label)}`;
    return;
  }
  button.disabled = false;
  button.classList.remove("is-busy");
  if (button.dataset.originalText) button.textContent = button.dataset.originalText;
}

async function runTossAction(actionKey, url, button, options = {}) {
  try {
    const before = await get("/api/rate-limits");
    const action = before.actions?.[actionKey];
    const disabledReason = rateLimitBlockReason(action, before.groups);
    if (disabledReason) {
      showActionRequestPreview(actionKey, before, `요청 한도 대기 중: ${disabledReason}`);
      return null;
    }

    setButtonBusy(button, true, "요청 중");
    showActionRequestPreview(actionKey, before, "요청을 보내는 중입니다.");
    const result = await post(url);
    const after = await get("/api/rate-limits");
    showActionRequestPreview(actionKey, after, `완료 · 이번 동작에서 Toss 요청 ${countRequestDelta(before, after)}회`);
    if (options.refreshAfter !== false) await refresh();
    return result;
  } catch (error) {
    showProgress("토스 요청 실패", humanError(error.message), "danger");
    return null;
  } finally {
    setButtonBusy(button, false);
    updateRateLimitedButtons(state?.runtime?.rateLimits);
  }
}

function renderBeginnerHero() {
  const { settings, runtime, health } = state;
  const riskGuard = state.riskGuard ?? {};
  const dry = runtime.mockMode || settings.dryRun || !settings.liveTradingEnabled;
  const apiProblem = !runtime.mockMode && (!health.tossConnected || Boolean(health.lastError));
  $("#headerChecklist").innerHTML = [
    ["토스 API", apiStatusLabel(runtime, health), apiProblem ? "sell" : runtime.mockMode ? "neutral" : "buy"],
    ["자동투자", settings.monitoringEnabled ? "켜짐" : "꺼짐", settings.monitoringEnabled ? "buy" : "neutral"],
    ["실제 주문", dry ? "잠김" : "허용", dry ? "neutral" : "sell"],
    ["당일 손실", riskGuard.blocked ? "한도 도달" : `${money(riskGuard.totalPnlUsd ?? 0)}`, riskGuard.blocked ? "sell" : "neutral"],
    ["마지막 확인", formatTime(settings.lastRunAt), apiProblem ? "sell" : "neutral"]
  ]
    .map(
      ([label, value, kind]) => `
      <div class="check-item">
        <span>${label}</span>
        <strong class="badge ${kind}">${value}</strong>
      </div>
    `
    )
    .join("");
  renderPublicIp();
  renderMobileUrl();
}

function renderPublicIp() {
  const publicIp = state.runtime?.publicIp ?? {};
  const ipText = publicIp.ip || "조회 실패";
  $("#publicIpText").textContent = ipText;
  $("#copyPublicIp").disabled = !publicIp.ip;
  $("#publicIpNote").textContent = publicIp.error
    ? publicIp.error
    : publicIp.ip
      ? `${formatTime(publicIp.checkedAt)} 확인 · 토스 허용 IP에 추가`
      : "공인 IP를 확인하고 있습니다.";
}

async function copyPublicIp() {
  const ip = state.runtime?.publicIp?.ip;
  if (!ip) return;
  try {
    await navigator.clipboard.writeText(ip);
    showProgress("공인 IP 복사 완료", `${ip} 를 클립보드에 복사했습니다.`, "success");
  } catch {
    prompt("아래 IP를 복사해서 토스 허용 IP에 추가하세요.", ip);
  }
}

function renderMobileUrl() {
  const localNetwork = state.runtime?.localNetwork ?? {};
  const primary = localNetwork.primary;
  $("#mobileUrlText").textContent = primary?.url || "조회 실패";
  $("#copyMobileUrl").disabled = !primary?.url;
  const alternatives = (localNetwork.addresses ?? [])
    .filter((item) => item.url !== primary?.url)
    .slice(0, 2)
    .map((item) => item.url)
    .join(" · ");
  $("#mobileUrlNote").textContent = primary?.url
    ? `같은 와이파이/핫스팟에서 접속${alternatives ? ` · 후보 ${alternatives}` : ""}`
    : "내부 IP를 찾지 못했습니다. 같은 네트워크에 연결되어 있는지 확인하세요.";
}

async function copyMobileUrl() {
  const url = state.runtime?.localNetwork?.primary?.url;
  if (!url) return;
  try {
    await navigator.clipboard.writeText(url);
    showProgress("모바일 접속 주소 복사 완료", `${url} 를 클립보드에 복사했습니다.`, "success");
  } catch {
    prompt("휴대폰 브라우저에 입력할 주소입니다.", url);
  }
}

async function refreshPublicIp() {
  const button = $("#refreshPublicIp");
  try {
    setButtonBusy(button, true, "확인 중");
    const publicIp = await get("/api/public-ip?refresh=true");
    state = {
      ...state,
      runtime: {
        ...state.runtime,
        publicIp
      }
    };
    renderPublicIp();
    showProgress("공인 IP 확인 완료", publicIp.ip ? `${publicIp.ip} 를 확인했습니다.` : humanError(publicIp.error), publicIp.ip ? "success" : "danger");
  } finally {
    setButtonBusy(button, false);
  }
}

function renderSettings() {
  const { settings, health, runtime } = state;
  $("#monitoringEnabled").checked = Boolean(settings.monitoringEnabled);
  $("#liveTradingEnabled").checked = Boolean(settings.liveTradingEnabled);
  $("#allowFractional").checked = Boolean(settings.allowFractional);
  $("#useVirtualSeed").checked = settings.useVirtualSeed !== false;
  $("#allowSeedTopUp").checked = Boolean(settings.allowSeedTopUp);
  $("#allowExtendedHoursDefensiveSells").checked =
    Boolean(settings.allowExtendedHoursDefensiveSells ?? settings.allowExtendedHoursTrading);
  $("#redistributeUnusedAllocation").checked = Boolean(settings.redistributeUnusedAllocation);
  $("#allowAdditionalBuys").checked = Boolean(settings.allowAdditionalBuys);
  $("#allocationUsd").value = settings.allocationUsd;
  $("#cashBufferUsd").value = settings.cashBufferUsd;
  $("#pollIntervalSec").value = settings.pollIntervalSec;
  $("#maxDailyLossPct").value = settings.maxDailyLossPct;
  $("#maxPositionPct").value = settings.maxPositionPct;
  $("#maxLeveragedExposurePct").value = settings.maxLeveragedExposurePct;
  $("#intradayDropBlockPct").value = settings.intradayDropBlockPct;
  $("#intradayPanicExitPct").value = settings.intradayPanicExitPct;
  $("#additionalBuyCooldownMinutes").value = settings.additionalBuyCooldownMinutes;
  const apiProblem = !runtime.mockMode && (!health.tossConnected || Boolean(health.lastError));
  $("#statusText").textContent = apiProblem
    ? `연결 오류 · ${humanError(health.lastError)}`
    : `${statusLabel(health.status)} · ${formatTime(settings.lastRunAt)}`;
  $("#mockBadge").textContent = apiProblem ? "API 오류" : runtime.mockMode || settings.dryRun ? "연습" : "실거래";
  $("#mockBadge").className = apiProblem ? "badge sell" : runtime.mockMode || settings.dryRun ? "badge neutral" : "badge sell";
  $("#accountMode").textContent = "봇 전용";
  $("#accountMode").className = "badge neutral";
  $("#lastRunAt").textContent = settings.lastRunAt ? formatTime(settings.lastRunAt) : "";
  $("#monitoringLabel").textContent = settings.monitoringEnabled ? "조건 확인 중" : "멈춤";
  $("#fractionalLabel").textContent = settings.allowFractional ? "켜짐" : "꺼짐";
  $("#virtualSeedLabel").textContent = settings.useVirtualSeed !== false ? "사용" : "고정한도";
  $("#allowSeedTopUp").disabled = settings.useVirtualSeed === false;
  $("#seedTopUpLabel").textContent = settings.useVirtualSeed !== false && settings.allowSeedTopUp ? "허용" : "꺼짐";
  renderTradingSessionControls();
  $("#liveTradingLabel").textContent = settings.liveTradingEnabled ? "허용됨" : "잠김";
  $("#redistributeLabel").textContent = settings.redistributeUnusedAllocation ? "켜짐" : "꺼짐";
  $("#additionalBuyLabel").textContent = settings.allowAdditionalBuys ? "켜짐" : "꺼짐";
}

function renderAutomation() {
  const settings = state.settings ?? {};
  $("#autoSafetyRecommendations").checked = Boolean(settings.autoSafetyRecommendations);
  $("#autoWeightRecommendations").checked = Boolean(settings.autoWeightRecommendations);
  $("#autoTargetRecommendations").checked = Boolean(settings.autoTargetRecommendations);
  $("#autoLearningReports").checked = Boolean(settings.autoLearningReports);
  $("#autoRecommendationIntervalMinutes").value = settings.autoRecommendationIntervalMinutes ?? 360;
  $("#autoSafetyLabel").textContent = settings.autoSafetyRecommendations ? "자동" : "수동";
  $("#autoWeightLabel").textContent = settings.autoWeightRecommendations ? "자동" : "수동";
  $("#autoTargetLabel").textContent = settings.autoTargetRecommendations ? "자동" : "수동";
  $("#autoLearningLabel").textContent = settings.autoLearningReports ? "자동" : "수동";
  const automation = state.automation ?? {};
  const activeCount = [
    settings.autoSafetyRecommendations,
    settings.autoWeightRecommendations,
    settings.autoTargetRecommendations,
    settings.autoLearningReports
  ].filter(Boolean).length;
  $("#automationSummary").textContent = `${activeCount}개 자동`;
  $("#automationSummary").className = activeCount ? "badge buy" : "badge neutral";
  const lastActions = automation.lastActions ?? [];
  $("#automationNote").innerHTML = lastActions.length
    ? `<strong>최근 자가판단</strong> ${escapeHtml(formatTime(automation.lastRunAt))}<br>${lastActions
        .map((item) => `· ${escapeHtml(item.message)}`)
        .join("<br>")}`
    : "아직 자동 자가판단 기록이 없습니다.";
}

function renderTradingSessionControls() {
  const fractionalOn = $("#allowFractional").checked;
  const extendedInput = $("#allowExtendedHoursDefensiveSells");
  $("#extendedHoursLabel").textContent = fractionalOn
    ? extendedInput.checked
      ? "정수 방어매도"
      : "정규장만"
    : extendedInput.checked
      ? "방어매도 허용"
      : "정규장만";
}

function renderRateLimits() {
  const rateLimits = state.runtime?.rateLimits;
  if (!rateLimits) return;
  $("#rateLimitUpdatedAt").textContent = `갱신 ${formatTime(rateLimits.generatedAt)}`;
  if (lastActionRequestPreview && Date.now() < lastActionRequestPreview.expiresAt) {
    renderActionPreviewContent(lastActionRequestPreview.actionKey, rateLimits, lastActionRequestPreview.detail);
  } else {
    lastActionRequestPreview = null;
    const monitorAction = rateLimits.actions?.monitorTick;
    $("#actionRequestPreview").innerHTML =
      `<strong>자동 모니터링 1회 예상</strong> ${renderActionRequestSummary(monitorAction, rateLimits.groups)}`;
  }
  $("#rateLimitList").innerHTML = Object.entries(rateLimits.groups ?? {})
    .filter(([key, group]) => group.total > 0 || ["MARKET_DATA", "MARKET_DATA_CHART", "MARKET_INFO", "ASSET", "ACCOUNT", "ORDER", "ORDER_HISTORY"].includes(key))
    .map(([key, group]) => renderRateLimitItem(key, group))
    .join("");
  updateRateLimitedButtons(rateLimits);
}

function renderRateLimitItem(key, group) {
  const blocked = Number(group.blockedForSec ?? 0) > 0;
  const low = Number(group.remaining ?? 0) <= 0;
  const statusClass = blocked || low ? "sell" : Number(group.remaining) <= 1 ? "neutral" : "buy";
  const last = group.lastEndpoint ? `${group.lastEndpoint} · ${formatTime(group.lastRequestAt)} · ${group.lastStatus}` : "아직 요청 없음";
  return `
    <div class="rate-item">
      <div>
        <strong>${escapeHtml(group.label ?? key)}</strong>
        <span>${escapeHtml(last)}</span>
      </div>
      <b class="badge ${statusClass}">${group.remaining}/${group.limit}</b>
      <small>${blocked ? `${group.blockedForSec}초 대기` : `${group.resetInSec}초 뒤 초기화`}</small>
    </div>
  `;
}

function showActionRequestPreview(actionKey, snapshot, detail) {
  lastActionRequestPreview = {
    actionKey,
    detail,
    expiresAt: Date.now() + 15_000
  };
  renderActionPreviewContent(actionKey, snapshot, detail);
  state = state ? { ...state, runtime: { ...state.runtime, rateLimits: snapshot } } : state;
  renderRateLimitListOnly(snapshot);
}

function renderActionPreviewContent(actionKey, snapshot, detail) {
  const action = snapshot.actions?.[actionKey];
  $("#actionRequestPreview").innerHTML = `
    <strong>${escapeHtml(action?.label ?? "요청")}</strong>
    <p>${escapeHtml(detail)}</p>
    ${renderActionRequestSummary(action, snapshot.groups)}
  `;
}

function renderRateLimitListOnly(snapshot) {
  if (!snapshot?.groups || !$("#rateLimitList")) return;
  $("#rateLimitUpdatedAt").textContent = `갱신 ${formatTime(snapshot.generatedAt)}`;
  $("#rateLimitList").innerHTML = Object.entries(snapshot.groups)
    .map(([key, group]) => renderRateLimitItem(key, group))
    .join("");
  updateRateLimitedButtons(snapshot);
}

function renderActionRequestSummary(action, groups) {
  if (!action?.requests) return "<span class=\"muted\">요청 정보 대기 중</span>";
  return `
    <div class="request-chip-row">
      ${action.requests
        .map((request) => {
          const group = groups?.[request.group] ?? {};
          const variable = request.variable ? request.variableLabel ?? "조건 충족 시" : `${request.count}회`;
          return `<span class="request-chip">${escapeHtml(group.label ?? request.group)} ${escapeHtml(variable)} · 남음 ${group.remaining ?? "-"}/${group.limit ?? "-"} · ${group.resetInSec ?? "-"}초</span>`;
        })
        .join("")}
    </div>
  `;
}

function rateLimitBlockReason(action, groups) {
  if (!action?.requests || !groups) return "";
  for (const request of action.requests) {
    const group = groups[request.group];
    if (!group) continue;
    if (Number(group.blockedForSec ?? 0) > 0) return `${group.label} ${group.blockedForSec}초 뒤 재시도`;
    if (Number(group.remaining ?? 0) <= 0 && Number(group.resetInSec ?? 0) > 0) {
      return `${group.label} ${group.resetInSec}초 뒤 초기화`;
    }
  }
  return "";
}

function updateRateLimitedButtons(rateLimits) {
  if (!rateLimits?.actions || !rateLimits?.groups) return;
  const pairs = [
    ["runOnce", $("#runOnce")],
    ["syncOrders", $("#syncOrders")],
    ["testConnection", $("#testConnection")]
  ];
  for (const [actionKey, button] of pairs) {
    if (!button || button.classList.contains("is-busy")) continue;
    const reason = rateLimitBlockReason(rateLimits.actions[actionKey], rateLimits.groups);
    button.disabled = Boolean(reason);
    button.title = reason || button.getAttribute("aria-label") || button.textContent;
  }
}

function countRequestDelta(before, after) {
  return Object.keys(after.groups ?? {}).reduce((sum, group) => {
    const beforeTotal = Number(before.groups?.[group]?.total ?? 0);
    const afterTotal = Number(after.groups?.[group]?.total ?? 0);
    return sum + Math.max(0, afterTotal - beforeTotal);
  }, 0);
}

function renderTargets() {
  targetGrid.innerHTML = "";
  const template = $("#targetCardTemplate");
  for (const target of state.targets) {
    const snapshot = state.marketSnapshots[target.symbol] ?? {};
    const signal = target.enabled ? snapshot.signal ?? {} : { action: "HOLD", reasons: ["종목 자동매매 OFF"], metrics: snapshot.signal?.metrics ?? {} };
    const metrics = signal.metrics ?? {};
    const position = snapshot.position ?? {};
    const backtest = snapshot.backtest ?? {};
    const card = template.content.cloneNode(true);
    card.querySelector(".symbol").textContent = target.symbol;
    card.querySelector(".name").textContent = target.name;
    card.querySelector(".target-toggle").checked = Boolean(target.enabled);
    card.querySelector(".target-toggle").addEventListener("change", async (event) => {
      await patch(`/api/targets/${target.symbol}`, { enabled: event.target.checked });
      await refresh();
    });
    card.querySelector(".last-price").textContent = money(metrics.lastPrice);
    const action = card.querySelector(".action");
    action.textContent = actionLabel(signal.action ?? "HOLD");
    action.className = `action badge ${(signal.action ?? "").toLowerCase()}`;
    card.querySelector(".rsi").textContent = value(metrics.rsi14);
    card.querySelector(".atr").textContent = pct(metrics.atrPct);
    card.querySelector(".momentum").textContent = pct(metrics.momentumPct ?? metrics.momentum5dPct);
    card.querySelector(".backtest").textContent = backtest.available
      ? `${pct(backtest.winRatePct)} · ${pct(backtest.totalReturnPct)}`
      : "대기";
    card.querySelector(".allocation").textContent = state.settings.redistributeUnusedAllocation
      ? `몰아주기 · 기본 ${target.allocationPct}%`
      : `${target.allocationPct}%`;
    card.querySelector(".position-label").textContent = position.active
      ? `보유 ${value(position.quantity)}주 · 평균 ${money(position.averagePrice)}`
      : "보유 없음";
    const risk = signal.risk ?? {};
    const eventRisk = risk.event;
    const newsRisk = risk.news;
    const eventEl = card.querySelector(".event-risk");
    const newsEl = card.querySelector(".news-risk");
    eventEl.textContent = eventRisk?.blocked
      ? `이벤트: 신규매수 대기 (${eventRisk.activeEvent?.title ?? "중요 일정"})`
      : eventRisk?.upcomingEvent
        ? `이벤트: 예정 ${formatShortDate(eventRisk.upcomingEvent.startsAt)}`
        : "이벤트: 특별 일정 없음";
    eventEl.className = `event-risk ${eventRisk?.blocked ? "danger" : "calm"}`;
    newsEl.textContent =
      newsRisk?.budgetMultiplier < 1
        ? `뉴스: 비중 축소 (${newsRisk.label})`
        : `뉴스: ${newsRisk?.label ?? "중립"}`;
    newsEl.className = `news-risk ${newsRisk?.budgetMultiplier < 1 ? "danger" : "calm"}`;
    renderTargetStrategy(card, target, snapshot);
    card.querySelector(".mini-chart").innerHTML = renderMiniChartCanvas();
    card.querySelector(".reason").textContent = plainReasons(signal.reasons ?? []).slice(0, 3).join(" · ");
    const chartRoot = card.querySelector(".mini-chart");
    targetGrid.append(card);
    drawCandleChart(chartRoot.querySelector("canvas"), snapshot.chart, position.active);
  }
}

function renderTargetStrategy(card, target, snapshot) {
  const rawReview = target.lastStrategyReview ?? null;
  const rawSnapshotBacktest = snapshot.backtest ?? null;
  const review = isCurrentEngineResult(rawReview) ? rawReview : null;
  const snapshotBacktest = isCurrentEngineResult(rawSnapshotBacktest) ? rawSnapshotBacktest : null;
  const score = review?.score ?? snapshotBacktest?.score ?? null;
  const grade = review?.grade ?? scoreGrade(score);
  const scoreEl = card.querySelector(".strategy-score");
  scoreEl.textContent = Number.isFinite(Number(score)) ? `${score}/100 · ${grade}` : "점수 대기";
  scoreEl.className = `strategy-score badge ${scoreBadgeClass(score)}`;

  card.querySelector(".strategy-details").innerHTML = [
    ["이동평균", `${target.fastSmaDays ?? 20}/${target.slowSmaDays ?? 50}`],
    ["모멘텀", `${target.momentumDays ?? 5}일`],
    ["매수 RSI", `${target.minBuyRsi ?? 45}~${target.maxBuyRsi ?? 72}`],
    ["손절/익절", `${target.stopLossPct}% / ${target.takeProfitPct}%`],
    ["1차익절", `${target.partialTakeProfitPct ?? 10}%에서 ${target.partialTakeProfitSellPct ?? 40}% 매도`],
    ["변동성 제한", `${target.maxAtrPct}%`]
  ]
    .map(([label, value]) => `<span><em>${escapeHtml(label)}</em><b>${escapeHtml(String(value))}</b></span>`)
    .join("");

  const perfParts = [];
  if (review?.summary) perfParts.push(review.summary);
  const reviewAlreadyHasPerformance = review?.summary && /수익률|승률|최대낙폭/.test(review.summary);
  if (snapshotBacktest?.summary && snapshotBacktest.summary !== review?.summary && !reviewAlreadyHasPerformance) {
    perfParts.push(snapshotBacktest.summary);
  }
  const coverage = review?.guardCoverage ?? snapshotBacktest?.guardCoverage;
  const guardImpact = review?.guardImpact ?? snapshotBacktest?.guardImpact;
  const alphaBacktest = review?.alphaBacktest ?? snapshotBacktest?.alphaBacktest;
  const guardedBacktest = review?.guardedBacktest ?? snapshotBacktest?.guardedBacktest;

  const scoreLine =
    alphaBacktest?.score !== undefined && guardedBacktest?.score !== undefined
      ? `전략만 ${alphaBacktest.score}/100 · 안전장치 포함 ${guardedBacktest.score}/100`
      : null;
  let impactLine = null;
  if (guardImpact) {
    const scoreChange = Number(guardImpact.scoreChange ?? 0);
    const returnChange = Number(guardImpact.returnPctChange ?? 0);
    impactLine = `점수 ${scoreChange >= 0 ? "+" : ""}${scoreChange} · 수익률 ${returnChange >= 0 ? "+" : ""}${returnChange}%p`;
  }

  const basis = review ? "추천값 검토" : "현재 저장값";
  const periodText = review?.robust
    ? `${basis} · 훈련 ${review.trainDays}일 / 검증 ${review.validationDays}일`
    : review?.days || snapshotBacktest?.days
      ? `${basis} · 최근 ${review?.days ?? snapshotBacktest.days}일`
      : null;

  const reviewEl = card.querySelector(".strategy-review");
  if (!review && !snapshotBacktest) {
    reviewEl.innerHTML = `<p class="review-empty">${escapeHtml(
      rawReview || rawSnapshotBacktest
        ? "전략 엔진이 바뀌어 추천값 또는 백테스트 재계산이 필요합니다."
        : "추천값 버튼을 누르면 외부 데이터로 점수와 검증구간을 계산합니다."
    )}</p>`;
    return;
  }

  const rows = [];
  if (periodText) rows.push(reviewLine("검증", periodText));
  if (perfParts.length) rows.push(reviewLine("성과", perfParts.join(" · ")));
  if (scoreLine || impactLine) {
    rows.push(reviewLine("점수", [scoreLine, impactLine ? `영향 ${impactLine}` : null].filter(Boolean).join(" · ")));
  }
  if (coverage?.included?.length) rows.push(reviewChips("방어 포함", coverage.included, "on"));
  if (coverage?.excluded?.length) rows.push(reviewChips("미포함", coverage.excluded, "off"));
  reviewEl.innerHTML = rows.join("");
}

function reviewLine(label, value) {
  return `<div class="review-line"><em>${escapeHtml(label)}</em><span>${escapeHtml(String(value))}</span></div>`;
}

function reviewChips(label, items, kind) {
  return `<div class="review-line"><em>${escapeHtml(label)}</em><div class="guard-chips">${items
    .map((item) => `<span class="guard-chip ${kind}">${escapeHtml(String(item))}</span>`)
    .join("")}</div></div>`;
}

function renderAccount() {
  const summary = $("#accountSummary");
  const holdings = $("#holdingsList");
  const bot = calculateBotPortfolio();
  const budget = bot.budget;
  const botReturnPct =
    budget.startingSeedUsd > 0 ? ((budget.equityUsd - budget.startingSeedUsd) / budget.startingSeedUsd) * 100 : 0;
  const budgetHint = budgetStatusText(budget);
  summary.innerHTML = `
    <div class="row-item">
      <div class="row-top"><strong>${money(budget.equityUsd)}</strong><span class="badge ${botReturnPct >= 0 ? "buy" : "sell"}">${pct(botReturnPct)}</span></div>
      <div class="row-meta">봇 현재자산 · 보유 평가금액 ${money(bot.marketValue)} · 누적손익 ${money(bot.totalPnl)} · 확정 승률 ${bot.winRateLabel}</div>
    </div>
    <div class="budget-strip">
      <span><b>${money(budget.startingSeedUsd)}</b><small>시작 시드</small></span>
      <span><b>${money(budget.virtualCashUsd)}</b><small>봇 남은 현금</small></span>
      <span><b>${money(budget.equityUsd)}</b><small>봇 현재자산</small></span>
      <span><b>${money(budget.buyingPowerUsd)}</b><small>다음 매수 가능</small></span>
    </div>
    <p class="row-meta">${budget.mode === "virtual-seed" ? "정해둔 봇 자금만 사용 중" : "고정 한도 방식"} · 원금 보충 ${budget.allowSeedTopUp ? "허용" : "꺼짐"}${budget.reservedPendingBuyUsd > 0 ? ` · 미체결 예약 ${money(budget.reservedPendingBuyUsd)}` : ""}</p>
    <p class="budget-hint ${budgetHint.kind}">${escapeHtml(budgetHint.text)}</p>
  `;
  holdings.innerHTML = bot.items.length
    ? bot.items
        .map((item) =>
          row(
            `${item.symbol} · 봇 보유`,
            money(item.marketValue),
            `${value(item.quantity)}주 · 평균 ${money(item.averagePrice)} · 평가손익 ${money(item.pnl)} (${pct(item.pnlRate)})${item.reconciliationText ? ` · ${escapeHtml(item.reconciliationText)}` : ""}`
          )
        )
        .join("")
    : row("봇 보유 종목 없음", "-", "기존 토스 계좌 보유 종목은 제외하고, 이 봇이 매매한 종목만 보여줍니다.");
}

function renderValidation() {
  const host = $("#validationSummary");
  const gateBadge = $("#validationGate");
  const detail = $("#validationGateDetail");
  if (!host || !gateBadge || !detail) return;
  const v = state.validation;
  if (!v) {
    host.innerHTML = "";
    detail.innerHTML = `<p class="recommendation-note">검증 데이터를 계산하는 중입니다.</p>`;
    gateBadge.textContent = "대기";
    gateBadge.className = "badge neutral";
    return;
  }
  const b = v.benchmark ?? {};
  const m = v.metrics ?? {};
  const g = v.gate ?? {};
  const excess =
    g.excessReturnPct !== null && g.excessReturnPct !== undefined
      ? `${g.excessReturnPct >= 0 ? "+" : ""}${g.excessReturnPct}%p`
      : "-";
  const cards = [
    ["봇 수익률", v.botReturnPct != null ? pct(v.botReturnPct) : "-", `자산 ${money(v.equityUsd)} · 시드 ${money(v.seedUsd)}`],
    [
      "벤치마크 (SOXL 보유)",
      b.available ? pct(b.returnPct) : "대기",
      b.available ? `같은 현금흐름 보유 시 ${money(b.valueUsd)}` : "가격 데이터 없음"
    ],
    [
      "초과수익",
      excess,
      g.beatsBenchmark === null ? "비교 대기" : g.beatsBenchmark ? "단순보유 초과" : "단순보유 미달"
    ],
    [
      "승률 · 손익비",
      `${m.winRatePct != null ? pct(m.winRatePct) : "-"} · ${m.profitFactor != null ? m.profitFactor : "표본부족"}`,
      `왕복 ${m.cycleCount ?? 0} · 체결 ${m.finalTradeCount ?? 0}`
    ],
    ["최대낙폭 (MDD)", v.maxDrawdownPct != null ? pct(v.maxDrawdownPct) : "-", `일별 자산 ${v.equityCurvePoints ?? 0}일 적립`]
  ];
  host.innerHTML = cards
    .map(
      ([label, val, note]) =>
        `<div class="learning-card"><span>${escapeHtml(label)}</span><strong>${escapeHtml(String(val))}</strong><small>${escapeHtml(note)}</small></div>`
    )
    .join("");
  gateBadge.textContent = g.ready ? "증액 가능" : "증액 보류";
  gateBadge.className = `badge ${g.ready ? "buy" : "sell"}`;
  const checks = (g.checks ?? [])
    .map((check) => `<span class="diff-chip ${check.pass ? "" : "changed"}">${check.pass ? "✓" : "✗"} ${escapeHtml(check.label)}</span>`)
    .join(" ");
  detail.innerHTML = `
    <p class="recommendation-note">
      <strong>${g.ready ? "✅ 증액 게이트 통과" : "⏸ 증액 보류"}</strong> ${escapeHtml(g.verdict ?? "")}
      <br>${checks}
      <br><small>${escapeHtml(g.note ?? "")}</small>
    </p>`;
}

function renderSignals() {
  const rows = state.targets.map((target) => {
    const signal = target.enabled
      ? state.marketSnapshots[target.symbol]?.signal
      : { action: "HOLD", reasons: ["종목 자동매매 OFF"], metrics: state.marketSnapshots[target.symbol]?.signal?.metrics ?? {} };
    return row(
      `${target.symbol} · ${actionLabel(signal?.action ?? "HOLD")}`,
      money(signal?.metrics?.lastPrice),
      plainReasons(signal?.reasons ?? ["대기"]).join(" · ")
    );
  });
  $("#signalsList").innerHTML = rows.join("");
}

function renderTrades() {
  const tradeRows = state.tradeHistory.map((trade) => ({
    kind: "trade",
    time: trade.requestedAt,
    html:
          row(
            `${trade.symbol} · ${trade.side === "BUY" ? "매수" : "매도"}`,
            trade.execution
              ? `체결 ${value(trade.execution.filledQuantity)}주 · 평균 ${money(trade.execution.averageFilledPrice)}`
              : trade.fractional
                ? trade.orderAmount
                  ? `소수점 금액 ${money(trade.orderAmount)}`
                  : `소수점 수량 ${value(trade.quantity)}주`
                : `정수 수량 ${value(trade.quantity)}주`,
            `${trade.dryRun ? "연습 기록" : `실제 주문 ${trade.syncStatus ?? "대기"}`} · ${formatTime(trade.requestedAt)} · ${plainReasons([trade.error?.message ?? trade.reason]).join("")}`
          )
  }));
  const safetyRows = dedupeOrderEvents(state.orderEvents ?? []).map((event) => ({
    kind: "event",
    time: event.createdAt,
    html: row(
      `${event.symbol} · ${eventLabel(event)}`,
      event.type === "BUDGET"
        ? "자금 변경"
        : event.type === "SAFETY"
          ? "매매 안 함"
          : event.type === "ORDER_ERROR"
            ? "주문 실패"
            : event.type === "RECONCILE_WARNING"
              ? "확인 필요"
              : event.type === "EXTERNAL_HOLDING"
                ? "봇 제외"
                : "건너뜀",
      `${formatTime(event.createdAt)} · ${plainReasons([event.message]).join("")}`
    )
  }));
  const rows = [...tradeRows, ...safetyRows].sort((a, b) => new Date(b.time) - new Date(a.time));
  $("#tradeCount").textContent = `${rows.length}`;
  $("#tradeHistory").innerHTML = rows.length
    ? rows.map((item) => item.html).join("")
    : row("거래 이력 없음", "-", "자동투자를 켠 뒤 조건이 맞으면 이곳에 매수/매도 기록이 쌓입니다.");
}

function dedupeOrderEvents(events) {
  const recentByKey = new Map();
  return events.filter((event) => {
    const key = `${event.symbol}|${event.type}|${event.message}`;
    const createdAt = new Date(event.createdAt).getTime();
    const newerAt = recentByKey.get(key);
    if (Number.isFinite(newerAt) && newerAt - createdAt < 30 * 60_000) return false;
    recentByKey.set(key, createdAt);
    return true;
  });
}

function eventLabel(event) {
  if (event.type === "SAFETY") return "안전장치";
  if (event.type === "BUDGET") return "봇 자금";
  if (event.type === "RECOVERY") return "이력 복구";
  if (event.type === "ORDER_ERROR") return "주문 거절";
  if (event.type === "RECONCILE_WARNING") return "수량 불일치";
  if (event.type === "EXTERNAL_HOLDING") return "수동 매수 감지";
  return "주문 대기";
}

function calculateBotPortfolio() {
  const positions = state.positions ?? {};
  const performance = state.performance ?? {};
  const closedTrades = (state.tradeHistory ?? []).filter(
    (trade) => trade.side === "SELL" && Number.isFinite(Number(trade.realizedPnlUsd))
  );
  const winningTrades = closedTrades.filter((trade) => Number(trade.realizedPnlUsd) > 0);
  const winRate = closedTrades.length ? (winningTrades.length / closedTrades.length) * 100 : null;
  const items = Object.entries(positions)
    .map(([symbol, position]) => {
      const quantity = Number(position.quantity ?? 0);
      const cost = Number(position.investedAmountUsd ?? 0);
      const lastPrice = Number(state.marketSnapshots?.[symbol]?.signal?.metrics?.lastPrice ?? position.lastBuyPrice ?? position.averagePrice ?? 0);
      const marketValue = quantity > 0 && Number.isFinite(lastPrice) ? quantity * lastPrice : 0;
      const pnl = marketValue - cost;
      const pnlRate = cost > 0 ? (pnl / cost) * 100 : 0;
      return {
        symbol,
        quantity,
        averagePrice: Number(position.averagePrice ?? 0),
        cost,
        marketValue,
        pnl,
        pnlRate,
        reconciliationText:
          position.reconciliation?.status === "SHORTFALL"
            ? `계좌 수량 ${value(position.reconciliation.accountQuantity)}주와 불일치`
            : position.reconciliation?.status === "EXTERNAL_HOLDING"
              ? `수동 보유 ${value(position.reconciliation.externalQuantity)}주 제외`
              : null
      };
    })
    .filter((item) => item.quantity > DUST_EPSILON || item.cost > DUST_EPSILON);

  const marketValue = items.reduce((sum, item) => sum + item.marketValue, 0);
  const openCost = items.reduce((sum, item) => sum + item.cost, 0);
  const openPnl = items.reduce((sum, item) => sum + item.pnl, 0);
  const realizedPnl = Number(performance.realizedPnlUsd ?? 0);
  const totalBuyAmount = Number(performance.totalBuyAmountUsd ?? 0);
  const investedBase = totalBuyAmount > 0 ? totalBuyAmount : openCost;
  const budget = calculateBotBudget({ marketValue, openCost });

  return {
    items,
    marketValue,
    openCost,
    openPnl,
    realizedPnl,
    totalPnl: realizedPnl + openPnl,
    investedBase,
    closedTradeCount: closedTrades.length,
    winningTradeCount: winningTrades.length,
    winRate,
    winRateLabel: closedTrades.length ? `${pct(winRate)} (${winningTrades.length}/${closedTrades.length})` : "확정 전",
    budget
  };
}

function calculateBotBudget({ marketValue, openCost }) {
  const settings = state.settings ?? {};
  const serverBudget = state.botBudget ?? {};
  const startingSeedUsd = Number(serverBudget.startingSeedUsd ?? settings.allocationUsd ?? 0);
  const totalBuyAmount = Number(state.performance?.totalBuyAmountUsd ?? 0);
  const totalSellAmount = Number(state.performance?.totalSellAmountUsd ?? 0);
  const fallbackReservedPendingBuyUsd = (state.tradeHistory ?? [])
    .filter(
      (trade) =>
        trade.side === "BUY" &&
        !trade.dryRun &&
        !["FINAL", "DRY_RUN", "REJECTED", "CANCELED"].includes(String(trade.syncStatus ?? ""))
    )
    .reduce((sum, trade) => sum + Number(trade.orderAmount ?? trade.estimatedValueUsd ?? 0), 0);
  const reservedPendingBuyUsd = Number(serverBudget.reservedPendingBuyUsd ?? fallbackReservedPendingBuyUsd);
  const virtualCashUsd = Number.isFinite(Number(serverBudget.virtualCashUsd))
    ? Number(serverBudget.virtualCashUsd)
    : startingSeedUsd - totalBuyAmount + totalSellAmount - reservedPendingBuyUsd;
  const equityUsd = Number.isFinite(Number(serverBudget.equityUsd))
    ? Number(serverBudget.equityUsd)
    : virtualCashUsd + reservedPendingBuyUsd + marketValue;
  const cashBufferUsd = Number(settings.cashBufferUsd ?? 0);
  const useVirtualSeed = settings.useVirtualSeed !== false;
  const allowSeedTopUp = Boolean(settings.allowSeedTopUp);
  const topUpCashLimit = Math.max(0, startingSeedUsd - marketValue - reservedPendingBuyUsd);
  const cashForBudget = useVirtualSeed
    ? allowSeedTopUp
      ? Math.max(virtualCashUsd, topUpCashLimit)
      : virtualCashUsd
    : startingSeedUsd;

  return {
    mode: useVirtualSeed ? "virtual-seed" : "fixed-allocation",
    allowSeedTopUp,
    startingSeedUsd,
    virtualCashUsd,
    reservedPendingBuyUsd,
    equityUsd,
    buyingPowerUsd: Math.max(0, cashForBudget - cashBufferUsd),
    cashForBudgetUsd: cashForBudget,
    cashBufferUsd,
    openCost
  };
}

function budgetStatusText(budget) {
  if (budget.buyingPowerUsd > 0) {
    return { kind: "ok", text: `다음 매수는 최대 ${money(budget.buyingPowerUsd)} 안에서 계산됩니다.` };
  }
  if (budget.cashForBudgetUsd <= 0) {
    return { kind: "danger", text: "봇에 남은 현금이 없어 새 매수는 대기합니다. 필요하면 일회성 봇 자금 추가를 사용하세요." };
  }
  if (budget.cashBufferUsd >= budget.cashForBudgetUsd) {
    return { kind: "warn", text: `남겨둘 현금 ${money(budget.cashBufferUsd)}이 봇 현금보다 커서 새 매수는 대기합니다.` };
  }
  return { kind: "warn", text: "비중 한도나 레버리지 한도 때문에 새 매수 가능 금액이 없습니다." };
}

function renderNews() {
  $("#newsList").innerHTML = state.news.length
    ? state.news
        .map(
          (item) => `
            <article class="news-item ${item.sentiment ?? "neutral"}">
              <div class="news-title-row">
                <a href="${item.url}" target="_blank" rel="noreferrer">${escapeHtml(item.translatedTitle || item.title)}</a>
                <span class="badge ${sentimentClass(item.sentiment)}">${escapeHtml(item.signalLabel || "중립")}</span>
              </div>
              <div class="news-meta">${item.source} · ${item.category} · ${formatTime(item.publishedAt)}</div>
              <p class="row-meta">${escapeHtml(item.koreanSummary || item.summary || "")}</p>
              <p class="original-title">${escapeHtml(item.title ?? "")}</p>
            </article>
          `
        )
        .join("")
    : row("뉴스 없음", "-", "RSS 동기화 대기");
}

function renderStrategy() {
  const strategy = state.strategy;
  $("#strategyName").textContent = strategy.name;
  $("#strategyRules").innerHTML = [
    ["살 때", strategy.buyRules],
    ["팔 때", strategy.sellRules],
    ["안전장치", strategy.safeguards]
  ]
    .map(
      ([title, rules]) => `
      <div class="rule-box">
        <h3>${title}</h3>
        <p>${rules.map(escapeHtml).join("<br>")}</p>
      </div>
    `
    )
    .join("");
}

function renderLearning() {
  const learning = state.learning ?? {};
  const report = learning.lastReport;
  const summary = report?.summary ?? {};
  const quality = report?.dataQuality ?? {};
  const cards = [
    ["결정 샘플", summary.decisionSamples ?? learning.decisionSampleCount ?? learning.decisionSamples?.length ?? 0, "자동 수집"],
    ["주문 기록", summary.tradeCount ?? state.tradeHistory?.length ?? 0, `매수 ${summary.buyCount ?? "-"} · 매도 ${summary.sellCount ?? "-"}`],
    ["추천 계산", summary.recommendationEvents ?? learning.recommendationEvents?.length ?? 0, "추천값/비중/안전설정"],
    ["데이터 품질", quality.grade ?? "대기", quality.score !== undefined ? `${quality.score}/100` : "리포트 필요"]
  ];
  $("#learningSummary").innerHTML = cards
    .map(
      ([label, value, note]) => `
        <div class="learning-card">
          <span>${escapeHtml(label)}</span>
          <strong>${escapeHtml(String(value))}</strong>
          <small>${escapeHtml(note)}</small>
        </div>
      `
    )
    .join("");

  if (!report) {
    $("#learningActions").innerHTML = `
      <p class="recommendation-note">
        자동 수집은 백그라운드에서 진행됩니다. 버튼을 누르면 지금까지 쌓인 데이터로 개선 리포트를 만듭니다.
        전략과 추천값은 자동으로 바꾸지 않고, 리포트 확인 뒤 직접 적용하는 구조입니다.
      </p>
    `;
    return;
  }

  const symbolRows = Object.entries(report.bySymbol ?? {})
    .map(
      ([symbol, item]) => `
        <span class="diff-chip">${escapeHtml(symbol)} · 샘플 ${item.samples} · 주문 ${item.trades} · 최근 ${escapeHtml(item.latestAction ?? "-")} · 점수 ${escapeHtml(String(item.latestScore ?? "-"))}</span>
      `
    )
    .join("");
  const nextActions = (report.nextActions ?? [])
    .map((item) => `<li>${escapeHtml(item)}</li>`)
    .join("");
  const topSkips = (report.topSkips ?? [])
    .map((item) => `${item.label} ${item.count}회`)
    .join(" · ");

  $("#learningActions").innerHTML = `
    <p class="recommendation-note">
      <strong>최근 리포트</strong> ${formatTime(report.generatedAt)} · 엔진 ${escapeHtml(report.engineVersion)}
      <br><strong>주요 대기 사유</strong> ${escapeHtml(topSkips || "아직 충분한 대기 사유가 없습니다.")}
      <br><strong>종목별 상태</strong> ${symbolRows || "종목 데이터 대기"}
    </p>
    <ul class="learning-next">${nextActions}</ul>
  `;
}

function renderEditor() {
  targetEditor.innerHTML = "";
  for (const target of state.targets) {
    const rowEl = document.createElement("div");
    rowEl.className = "editor-row";
    rowEl.innerHTML = `
      ${editorInput("종목", target.symbol, "symbol", true)}
      ${editorInput("비중 %", target.allocationPct, "allocationPct")}
      ${editorInput("빠른선", target.fastSmaDays ?? 20, "fastSmaDays")}
      ${editorInput("느린선", target.slowSmaDays ?? 50, "slowSmaDays")}
      ${editorInput("모멘텀일", target.momentumDays ?? 5, "momentumDays")}
      ${editorInput("매수RSI하", target.minBuyRsi ?? 45, "minBuyRsi")}
      ${editorInput("매수RSI상", target.maxBuyRsi ?? 72, "maxBuyRsi")}
      ${editorInput("손절 %", target.stopLossPct, "stopLossPct")}
      ${editorInput("1차익절 %", target.partialTakeProfitPct ?? 10, "partialTakeProfitPct")}
      ${editorInput("일부매도 %", target.partialTakeProfitSellPct ?? 40, "partialTakeProfitSellPct")}
      ${editorInput("익절 %", target.takeProfitPct ?? 18, "takeProfitPct")}
      ${editorInput("고점 이탈 %", target.trailingStopPct, "trailingStopPct")}
      ${editorInput("과열 매도선", target.takeProfitRsi, "takeProfitRsi")}
      ${editorInput("변동성 제한", target.maxAtrPct, "maxAtrPct")}
      <button title="저장" data-action="save">저장</button>
      <button title="추천값 적용" data-action="recommend">추천값</button>
      <button title="정밀추천 적용" data-action="recommend-deep">정밀추천</button>
      <button title="내 저장값 불러오기" data-action="restore">내 저장값</button>
      <button title="삭제" data-action="delete">삭제</button>
      <p class="recommendation-note" data-role="recommendation-note"></p>
    `;
    renderTargetRecommendationNote(rowEl.querySelector('[data-role="recommendation-note"]'), target);
    rowEl.querySelector('[data-action="save"]').addEventListener("click", async () => {
      const payload = {};
      rowEl.querySelectorAll("input[data-key]").forEach((input) => {
        if (!input.disabled) payload[input.dataset.key] = Number(input.value);
      });
      await patch(`/api/targets/${target.symbol}`, payload);
      await refresh();
    });
    rowEl.querySelector('[data-action="recommend"]').addEventListener("click", async () => {
      const button = rowEl.querySelector('[data-action="recommend"]');
      const note = rowEl.querySelector('[data-role="recommendation-note"]');
      await applyTargetRecommendation({ target, rowEl, button, note, mode: "fast" });
    });
    rowEl.querySelector('[data-action="recommend-deep"]').addEventListener("click", async () => {
      const button = rowEl.querySelector('[data-action="recommend-deep"]');
      const note = rowEl.querySelector('[data-role="recommendation-note"]');
      await applyTargetRecommendation({ target, rowEl, button, note, mode: "deep" });
    });
    rowEl.querySelector('[data-action="restore"]').addEventListener("click", () => {
      applyEditorValues(rowEl, target);
      rowEl.querySelector('[data-role="recommendation-note"]').textContent = "저장되어 있던 내 설정값을 다시 불러왔습니다.";
    });
    rowEl.querySelector('[data-action="delete"]').addEventListener("click", async () => {
      if (!confirm(`${target.symbol} 삭제`)) return;
      await del(`/api/targets/${target.symbol}`);
      await refresh();
    });
    targetEditor.append(rowEl);
  }
}

async function applyTargetRecommendation({ target, rowEl, button, note, mode }) {
  const precise = mode === "deep";
      try {
        setButtonBusy(button, true, precise ? "정밀 계산 중" : "계산 중");
        note.innerHTML = `<span class="inline-progress"><span class="spinner"></span>${target.symbol} ${precise ? "정밀추천" : "추천값"} 계산 중 · 외부 일봉과 백테스트 조합을 확인하고 있습니다.</span>`;
        const monitorNote = state?.settings?.monitoringEnabled
          ? "자동 모니터링이 켜져 있어도 추천 계산은 Toss API를 호출하지 않습니다."
          : "추천 계산은 Toss API를 호출하지 않습니다.";
        showProgress(`${target.symbol} ${precise ? "정밀추천" : "추천값"} 계산 중`, `${precise ? "정밀 후보군을 넓게 검사합니다. 시간이 더 걸릴 수 있습니다." : "외부 가격 데이터와 1시간 캐시만 사용합니다."} ${monitorNote}`);
        const recommendation = await get(`/api/targets/${target.symbol}/recommendation${precise ? "?mode=deep" : ""}`);
        const beforeTarget = { ...target };
        const engineName = recommendation.engineVersion ?? currentStrategyName();
        applyEditorValues(rowEl, recommendation.recommended);
        const cacheText = recommendation.cache?.hit ? `캐시 사용 · 약 ${recommendation.cache.ttlMinutes}분 남음` : "새 외부 데이터로 계산";
        showProgress(`${target.symbol} ${precise ? "정밀추천" : "추천값"} 저장 중`, `${cacheText}. 계산된 추천값을 종목 설정에 저장하고 있습니다.`);
        state = preserveRuntimeState(await patch(`/api/targets/${target.symbol}`, recommendation.recommended));
        const savedTarget = state.targets.find((item) => item.symbol === target.symbol);
        if (savedTarget) {
          savedTarget.lastStrategyReview = summarizeRecommendationForUi(recommendation, engineName);
          savedTarget.lastRecommendation = summarizeTargetRecommendationForUi(beforeTarget, recommendation, engineName);
          Object.assign(target, savedTarget);
        }
        renderTargetRecommendationNote(note, {
          ...target,
          lastRecommendation: summarizeTargetRecommendationForUi(beforeTarget, recommendation, engineName)
        });
        renderTargets();
        showProgress(`${target.symbol} ${precise ? "정밀추천" : "추천값"} 저장 완료`, "추천값 계산과 저장이 모두 끝났습니다.", "success");
      } catch (error) {
        note.innerHTML = `<span class="warning-text">${precise ? "정밀추천" : "추천값"} 계산 실패: ${escapeHtml(humanError(error.message))}</span>`;
        showProgress(`${target.symbol} ${precise ? "정밀추천" : "추천값"} 계산 실패`, humanError(error.message), "danger");
      } finally {
        setButtonBusy(button, false);
      }
}

function renderTargetRecommendationNote(note, target) {
  if (!note) return;
  const recommendation = target.lastRecommendation;
  if (recommendation?.recommended && isCurrentEngineResult(recommendation)) {
    const saved = targetMatchesRecommendation(target, recommendation.recommended);
    note.innerHTML = `
      ${recommendation.score !== undefined ? `<strong>백테스트 점수</strong> ${escapeHtml(String(recommendation.score))}/100 · ${escapeHtml(recommendation.grade ?? "")}<br>` : ""}
      ${recommendation.warning ? `<span class="warning-text">${escapeHtml(recommendation.warning)}</span><br>` : ""}
      <strong>변경 비교</strong>
      ${renderRecommendationDiff(recommendation.before ?? target, recommendation.recommended)}
      <br><strong>추천 이유</strong>
      ${escapeHtml((recommendation.reasons ?? []).join(" "))}
      <br><strong>저장 상태</strong> ${saved ? `${formatTime(recommendation.calculatedAt)} 추천값을 저장했습니다.` : "추천값 계산은 완료됐지만 현재 저장값과 다릅니다. 추천값 버튼을 다시 누르면 저장합니다."}
    `;
    return;
  }

  const rawReview = target.lastStrategyReview;
  const review = isCurrentEngineResult(rawReview) ? rawReview : null;
  if (review?.score !== undefined && review?.score !== null) {
    note.innerHTML = `
      <strong>최근 추천 검토</strong> 백테스트 점수 ${escapeHtml(String(review.score))}/100 · ${escapeHtml(review.grade ?? scoreGrade(review.score))}
      ${review.warning ? `<br><span class="warning-text">${escapeHtml(review.warning)}</span>` : ""}
      <br><strong>검증 구간</strong> ${escapeHtml(strategyReviewPeriodText(review))}
      ${renderGuardImpactLine(review)}
      <br><strong>안내</strong> 이 결과는 이전 방식으로 저장되어 변경 비교/추천 이유 상세가 없습니다. 추천값 버튼을 다시 누르면 상세 설명도 저장됩니다.
    `;
    return;
  }

  if (rawReview?.score !== undefined || recommendation?.recommended) {
    note.innerHTML = `
      <strong>재계산 필요</strong> 전략 엔진이 ${escapeHtml(currentStrategyName())}로 바뀌었습니다.
      <br><strong>안내</strong> 이전 추천값 점수는 숨겼습니다. 추천값 버튼을 다시 누르면 새 기준으로 점수와 변경 비교를 저장합니다.
    `;
  }
}

function renderGuardImpactLine(review) {
  if (!review?.guardImpact) return "";
  const scoreChange = Number(review.guardImpact.scoreChange ?? 0);
  const returnChange = Number(review.guardImpact.returnPctChange ?? 0);
  const alphaScore = review.alphaBacktest?.score;
  const guardedScore = review.guardedBacktest?.score;
  const scores =
    alphaScore !== undefined && guardedScore !== undefined
      ? `전략만 ${alphaScore}/100, 안전장치 포함 ${guardedScore}/100 · `
      : "";
  return `<br><strong>안전장치 영향</strong> ${escapeHtml(scores)}점수 ${scoreChange >= 0 ? "+" : ""}${scoreChange}, 수익률 ${returnChange >= 0 ? "+" : ""}${returnChange}%p`;
}

function renderWeightRecommendationNote(recommendation) {
  const note = $("#weightRecommendationNote");
  if (!note) return;
  if (!recommendation?.weights) {
    note.textContent = "전체비중 추천은 활성 종목들의 변동성, 모멘텀, 레버리지, 이벤트/뉴스 위험을 함께 보고 계산합니다.";
    return;
  }
  const weights = Object.entries(recommendation.weights)
    .map(([symbol, weight]) => `${symbol} ${weight}%`)
    .join(" · ");
  const score = recommendation.score !== undefined ? ` · 점수 ${recommendation.score}/100 ${recommendation.grade ?? ""}` : "";
  const zeroNote = Object.values(recommendation.weights).some((weight) => Number(weight) === 0)
    ? "<br><span class=\"warning-text\">0%는 종목 삭제가 아니라 새 매수 배정을 하지 않는다는 뜻입니다.</span>"
    : "";
  note.innerHTML = `<strong>최근 전체비중 추천</strong> ${escapeHtml(weights + score)}${zeroNote}<br>${escapeHtml((recommendation.reasons ?? []).join(" "))}`;
}

function targetMatchesRecommendation(target, recommended) {
  if (!recommended) return false;
  return [
    "allocationPct",
    "fastSmaDays",
    "slowSmaDays",
    "momentumDays",
    "minBuyRsi",
    "maxBuyRsi",
    "stopLossPct",
    "partialTakeProfitPct",
    "partialTakeProfitSellPct",
    "takeProfitPct",
    "trailingStopPct",
    "takeProfitRsi",
    "maxAtrPct"
  ].every((key) => {
    if (recommended[key] === undefined) return true;
    return Math.abs(Number(target[key]) - Number(recommended[key])) < 0.0001;
  });
}

function renderSafetyRecommendationNote(recommendation) {
  const note = $("#safetyRecommendationNote");
  if (!note) return;
  if (!recommendation?.recommended) {
    note.textContent = "안전설정 추천은 자동투자 금액을 제외하고 현금버퍼, 당일 손실 한도, 레버리지 한도, 급락 기준을 계산합니다.";
    return;
  }
  const prefix = recommendation.canceled ? "최근 안전설정 추천 취소" : "최근 안전설정 추천";
  note.innerHTML = `<strong>${prefix}</strong> ${escapeHtml(renderSafetyRecommendationText(recommendation))}<br>${escapeHtml((recommendation.reasons ?? []).join(" "))}`;
}

function renderSafetyRecommendationText(recommendation) {
  const r = recommendation.recommended ?? {};
  return [
    `봇자금 ${r.useVirtualSeed ? "제한" : "고정한도"}`,
    `자동보충 ${r.allowSeedTopUp ? "허용" : "차단"}`,
    `현금 ${money(r.cashBufferUsd)}`,
    `손실경고 ${pct(r.maxDailyLossPct)}`,
    `종목최대 ${pct(r.maxPositionPct)}`,
    `레버리지한도 ${pct(r.maxLeveragedExposurePct)}`,
    `일봉급락대기 ${pct(r.intradayDropBlockPct)}`,
    `일봉급락매도 ${pct(r.intradayPanicExitPct)}`,
    `추가매수 ${r.allowAdditionalBuys ? "허용" : "차단"}`,
    `간격 ${r.additionalBuyCooldownMinutes}분`
  ].join(" · ");
}

function summarizeRecommendationForUi(recommendation, engineName = currentStrategyName()) {
  const backtest = recommendation.backtest ?? {};
  return {
    engineVersion: engineName,
    score: recommendation.score ?? null,
    grade: recommendation.grade ?? null,
    warning: recommendation.warning ?? null,
    summary: backtest.summary ?? null,
    days: backtest.days ?? null,
    robust: Boolean(backtest.robust),
    trainDays: backtest.train?.days ?? null,
    trainScore: backtest.train?.score ?? null,
    validationDays: backtest.validation?.days ?? null,
    validationScore: backtest.validation?.score ?? null,
    reviewedAt: new Date().toISOString()
  };
}

function summarizeTargetRecommendationForUi(beforeTarget, recommendation, engineName = currentStrategyName()) {
  return {
    engineVersion: engineName,
    score: recommendation.score ?? null,
    grade: recommendation.grade ?? null,
    warning: recommendation.warning ?? null,
    recommended: recommendation.recommended ?? null,
    before: beforeTarget,
    reasons: recommendation.reasons ?? [],
    calculatedAt: new Date().toISOString(),
    cache: recommendation.cache ?? null
  };
}

function isCurrentEngineResult(result) {
  return Boolean(result?.engineVersion && result.engineVersion === state.strategy?.name);
}

function currentStrategyName() {
  return state?.strategy?.name ?? "현재 전략";
}

function preserveRuntimeState(nextState) {
  return {
    ...nextState,
    strategy: nextState.strategy ?? state?.strategy ?? null,
    runtime: nextState.runtime ?? state?.runtime ?? null
  };
}

function strategyReviewPeriodText(review) {
  if (review.validationDays) {
    return `전체 ${review.days ?? "-"}일 · 학습 ${review.trainDays ?? "-"}일 · 검증 ${review.validationDays}일`;
  }
  if (review.days) return `최근 ${review.days}개 일봉`;
  return "검증 구간 정보 없음";
}

function applyEditorValues(rowEl, values) {
  rowEl.querySelectorAll("input[data-key]").forEach((input) => {
    if (input.disabled) return;
    if (values[input.dataset.key] !== undefined) input.value = values[input.dataset.key];
  });
}

function renderRecommendationDiff(current, recommended) {
  const labels = {
    allocationPct: "비중",
    fastSmaDays: "빠른선",
    slowSmaDays: "느린선",
    momentumDays: "모멘텀일",
    minBuyRsi: "매수RSI하",
    maxBuyRsi: "매수RSI상",
    stopLossPct: "손절",
    partialTakeProfitPct: "1차익절",
    partialTakeProfitSellPct: "일부매도",
    takeProfitPct: "익절",
    trailingStopPct: "고점 이탈",
    takeProfitRsi: "과열 매도선",
    maxAtrPct: "변동성 제한"
  };
  return Object.entries(labels)
    .map(([key, label]) => {
      const before = Number(current[key]);
      const after = Number(recommended[key]);
      const changed = Math.abs(before - after) >= 0.05;
      const suffix = key.includes("Pct") ? "%" : "";
      return `<span class="diff-chip ${changed ? "changed" : ""}">${label}: ${formatNumber(before)}${suffix} → ${formatNumber(after)}${suffix}</span>`;
    })
    .join(" ");
}

async function saveSettings() {
  await patch("/api/settings", readSettingsForm());
  await refresh();
}

function readSettingsForm() {
  const allowFractional = $("#allowFractional").checked;
  return {
    liveTradingEnabled: $("#liveTradingEnabled").checked,
    allowFractional,
    useVirtualSeed: $("#useVirtualSeed").checked,
    allowSeedTopUp: $("#useVirtualSeed").checked && $("#allowSeedTopUp").checked,
    allowExtendedHoursTrading: false,
    allowExtendedHoursDefensiveSells: $("#allowExtendedHoursDefensiveSells").checked,
    redistributeUnusedAllocation: $("#redistributeUnusedAllocation").checked,
    allowAdditionalBuys: $("#allowAdditionalBuys").checked,
    allocationUsd: Number($("#allocationUsd").value),
    cashBufferUsd: Number($("#cashBufferUsd").value),
    pollIntervalSec: Number($("#pollIntervalSec").value),
    maxDailyLossPct: Number($("#maxDailyLossPct").value),
    maxPositionPct: Number($("#maxPositionPct").value),
    maxLeveragedExposurePct: Number($("#maxLeveragedExposurePct").value),
    intradayDropBlockPct: Number($("#intradayDropBlockPct").value),
    intradayPanicExitPct: Number($("#intradayPanicExitPct").value),
    additionalBuyCooldownMinutes: Number($("#additionalBuyCooldownMinutes").value)
  };
}

function readAutomationForm() {
  return {
    autoSafetyRecommendations: $("#autoSafetyRecommendations").checked,
    autoWeightRecommendations: $("#autoWeightRecommendations").checked,
    autoTargetRecommendations: $("#autoTargetRecommendations").checked,
    autoLearningReports: $("#autoLearningReports").checked,
    autoRecommendationIntervalMinutes: Number($("#autoRecommendationIntervalMinutes").value)
  };
}

function editorInput(label, value, key, disabled = false) {
  return `
    <label>
      <span>${label}</span>
      <input data-key="${key}" value="${value}" ${disabled ? "disabled" : ""} />
    </label>
  `;
}

function row(left, right, meta) {
  return `
    <div class="row-item">
      <div class="row-top"><strong>${escapeHtml(String(left))}</strong><span>${escapeHtml(String(right))}</span></div>
      <div class="row-meta">${escapeHtml(String(meta))}</div>
    </div>
  `;
}

async function get(url) {
  const response = await fetch(url);
  return parseJsonResponse(response);
}

async function post(url, body = {}) {
  const response = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body)
  });
  return parseJsonResponse(response);
}

async function patch(url, body = {}) {
  const response = await fetch(url, {
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body)
  });
  return parseJsonResponse(response);
}

async function del(url) {
  const response = await fetch(url, { method: "DELETE" });
  return parseJsonResponse(response);
}

async function parseJsonResponse(response) {
  const payload = await response.json();
  if (!response.ok) {
    throw new Error(payload.error || `${response.status} ${response.statusText}`);
  }
  return payload;
}

function money(value) {
  const number = Number(value);
  if (!Number.isFinite(number)) return "-";
  return `$${number.toLocaleString(undefined, { maximumFractionDigits: 2 })}`;
}

function pct(value) {
  const number = Number(value);
  if (!Number.isFinite(number)) return "-";
  return `${number.toFixed(2)}%`;
}

function value(input) {
  if (input === null || input === undefined || input === "") return "-";
  const number = Number(input);
  return Number.isFinite(number) ? number.toLocaleString(undefined, { maximumFractionDigits: 4 }) : String(input);
}

function formatNumber(input) {
  const number = Number(input);
  if (!Number.isFinite(number)) return "-";
  return number.toLocaleString(undefined, { maximumFractionDigits: 2 });
}

function renderMiniChartCanvas() {
  return `<canvas class="candle-canvas" width="720" height="300" aria-label="최근 일봉 캔들 차트"></canvas>`;
}

function drawCandleChart(canvas, chart, hasPosition) {
  if (!canvas) return;
  const context = canvas.getContext("2d");
  const series = chart?.series ?? [];
  const ratio = window.devicePixelRatio || 1;
  const cssWidth = 720;
  const cssHeight = 300;
  canvas.width = cssWidth * ratio;
  canvas.height = cssHeight * ratio;
  context.setTransform(ratio, 0, 0, ratio, 0, 0);
  context.clearRect(0, 0, cssWidth, cssHeight);

  if (series.length < 2) {
    context.fillStyle = "#8ea0af";
    context.font = "24px system-ui";
    context.textAlign = "center";
    context.fillText("가격 데이터 대기 중", cssWidth / 2, cssHeight / 2);
    return;
  }

  const width = cssWidth;
  const height = cssHeight;
  const pad = { top: 24, right: 92, bottom: 28, left: 18 };
  const lineValues = hasPosition && chart?.lines ? Object.values(chart.lines).filter(Number.isFinite) : [];
  const prices = series
    .flatMap((point) => [Number(point.high), Number(point.low), Number(point.close)])
    .filter(Number.isFinite);
  const min = Math.min(...prices, ...lineValues);
  const max = Math.max(...prices, ...lineValues);
  const span = max - min || 1;
  const y = (price) => pad.top + ((max - price) / span) * (height - pad.top - pad.bottom);
  const x = (index) => pad.left + (index / Math.max(1, series.length - 1)) * (width - pad.left - pad.right);
  const step = (width - pad.left - pad.right) / Math.max(1, series.length);
  const candleWidth = Math.max(4, Math.min(12, step * 0.62));

  drawGrid(context, width, height, pad, min, max, y);
  for (let index = 0; index < series.length; index += 1) {
    const candle = series[index];
    drawCandle(context, {
      x: x(index),
      width: candleWidth,
      open: Number(candle.open),
      high: Number(candle.high),
      low: Number(candle.low),
      close: Number(candle.close),
      y
    });
  }

  if (hasPosition && chart?.lines) {
    const labels = layoutPriceLabels([
      { label: "최종익절", price: chart.lines.takeProfitPrice, color: "#6ee7b7", side: "left" },
      { label: "1차익절", price: chart.lines.partialTakeProfitPrice, color: "#f6c85f", side: "left" },
      { label: "매수가", price: chart.lines.buyPrice, color: "#9fc6ff", side: "left" },
      { label: "손절", price: chart.lines.stopLossPrice, color: "#ff9bae", side: "left" }
    ], y, height, pad);
    labels.forEach((line) => drawPriceLine(context, line, width, pad));
  }

  const last = Number(series.at(-1)?.close);
  drawPriceLabel(context, { label: money(last), value: "", y: y(last), labelY: y(last), color: "#8ea0af" }, width, pad);
}

function drawGrid(context, width, height, pad, min, max, y) {
  context.strokeStyle = "rgba(142, 160, 175, 0.16)";
  context.lineWidth = 1;
  context.setLineDash([]);
  [min, (min + max) / 2, max].forEach((price) => {
    const lineY = y(price);
    context.beginPath();
    context.moveTo(pad.left, lineY);
    context.lineTo(width - pad.right, lineY);
    context.stroke();
  });
  context.fillStyle = "#8ea0af";
  context.font = "20px system-ui";
  context.textAlign = "right";
  context.fillText(money(max), width - 10, y(max) + 8);
  context.fillText(money(min), width - 10, y(min));
}

function drawCandle(context, candle) {
  if (![candle.open, candle.high, candle.low, candle.close].every(Number.isFinite)) return;
  const rising = candle.close >= candle.open;
  const color = rising ? "#19c37d" : "#ff5c7a";
  const center = candle.x;
  const openY = candle.y(candle.open);
  const closeY = candle.y(candle.close);
  const highY = candle.y(candle.high);
  const lowY = candle.y(candle.low);
  const top = Math.min(openY, closeY);
  const bodyHeight = Math.max(2, Math.abs(closeY - openY));

  context.strokeStyle = color;
  context.fillStyle = rising ? "rgba(25, 195, 125, 0.78)" : "rgba(255, 92, 122, 0.78)";
  context.lineWidth = 2;
  context.beginPath();
  context.moveTo(center, highY);
  context.lineTo(center, lowY);
  context.stroke();
  context.fillRect(center - candle.width / 2, top, candle.width, bodyHeight);
}

function layoutPriceLabels(lines, y, height, pad) {
  const valid = lines
    .map((line) => {
      const price = Number(line.price);
      if (!Number.isFinite(price)) return null;
      return {
        ...line,
        value: money(price),
        y: y(price),
        labelY: Math.max(pad.top + 10, Math.min(y(price), height - pad.bottom - 10))
      };
    })
    .filter(Boolean)
    .sort((left, right) => left.labelY - right.labelY);
  const minGap = 22;
  for (let index = 1; index < valid.length; index += 1) {
    if (valid[index].labelY - valid[index - 1].labelY < minGap) {
      valid[index].labelY = valid[index - 1].labelY + minGap;
    }
  }
  for (let index = valid.length - 2; index >= 0; index -= 1) {
    if (valid[index + 1].labelY > height - pad.bottom - 8) valid[index + 1].labelY = height - pad.bottom - 8;
    if (valid[index + 1].labelY - valid[index].labelY < minGap) {
      valid[index].labelY = valid[index + 1].labelY - minGap;
    }
  }
  return valid.map((line) => ({
    ...line,
    labelY: Math.max(pad.top + 8, Math.min(line.labelY, height - pad.bottom - 8))
  }));
}

function drawPriceLine(context, line, width, pad) {
  context.strokeStyle = line.color;
  context.lineWidth = 2;
  context.setLineDash([10, 8]);
  context.beginPath();
  context.moveTo(pad.left, line.y);
  context.lineTo(width - pad.right, line.y);
  context.stroke();
  context.setLineDash([]);
  if (Math.abs(line.labelY - line.y) > 2) {
    context.setLineDash([]);
    context.strokeStyle = line.color;
    context.lineWidth = 1;
    context.beginPath();
    if (line.side === "left") {
      context.moveTo(pad.left + 2, line.y);
      context.lineTo(pad.left + 12, line.labelY);
    } else {
      context.moveTo(width - pad.right + 2, line.y);
      context.lineTo(width - pad.right + 12, line.labelY);
    }
    context.stroke();
  }
  drawPriceLabel(context, line, width, pad);
}

function drawPriceLabel(context, line, width, pad) {
  const leftLabel = line.side === "left";
  const x = leftLabel ? pad.left + 10 : width - pad.right + 14;
  const y = Math.max(pad.top + 8, Math.min(line.labelY, 286));
  const labelText = line.value ? `${line.label} ${line.value}` : line.label;
  context.font = "bold 15px system-ui";
  const textWidth = context.measureText(labelText).width;
  context.fillStyle = "rgba(11, 17, 24, 0.82)";
  const maxWidth = leftLabel ? width - pad.left - pad.right - 28 : pad.right - 20;
  context.fillRect(x - 5, y - 11, Math.min(textWidth + 10, maxWidth), 22);
  context.fillStyle = line.color;
  context.textAlign = "left";
  context.textBaseline = "middle";
  context.fillText(labelText, x, y, maxWidth - 8);
}

function formatTime(input) {
  if (!input) return "-";
  const date = new Date(input);
  if (Number.isNaN(date.getTime())) return String(input);
  return new Intl.DateTimeFormat("ko-KR", {
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit"
  }).format(date);
}

function formatShortDate(input) {
  if (!input) return "-";
  const date = new Date(input);
  if (Number.isNaN(date.getTime())) return "-";
  return new Intl.DateTimeFormat("ko-KR", {
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit"
  }).format(date);
}

function actionLabel(action) {
  return {
    BUY: "매수 후보",
    PARTIAL_SELL: "일부매도 후보",
    SELL: "매도 후보",
    HOLD: "대기"
  }[action] ?? action;
}

function sentimentClass(sentiment) {
  return {
    positive: "buy",
    negative: "sell",
    neutral: "neutral"
  }[sentiment] ?? "neutral";
}

function statusLabel(status) {
  return {
    idle: "대기",
    paused: "멈춤",
    monitoring: "확인 중"
  }[status] ?? status;
}

function scoreGrade(score) {
  const value = Number(score);
  if (!Number.isFinite(value)) return "";
  if (value >= 85) return "우수";
  if (value >= 70) return "주의하며 사용";
  if (value >= 55) return "소액 테스트";
  return "전략 재검토";
}

function scoreBadgeClass(score) {
  const value = Number(score);
  if (!Number.isFinite(value)) return "neutral";
  if (value >= 85) return "buy";
  if (value >= 70) return "neutral";
  return "sell";
}

function apiStatusLabel(runtime, health) {
  if (runtime.mockMode) return "연습 데이터";
  if (health.lastError) return "연결 실패";
  return health.tossConnected ? "연결됨" : "확인 필요";
}

function humanError(error) {
  if (!error) return "토스 API 응답을 아직 확인하지 못했습니다.";
  if (String(error).includes("IP address not allowed")) {
    return "허용 IP에 현재 공인 IP를 등록해야 합니다.";
  }
  return String(error);
}

function plainReasons(reasons) {
  return reasons.map((reason) =>
    String(reason)
      .replaceAll("전체 모니터링 OFF", "자동투자 꺼짐")
      .replaceAll("종목 자동매매 OFF", "이 종목 꺼짐")
      .replaceAll("추세 조건 미충족", "상승 흐름이 아직 약함")
      .replaceAll("RSI 조건 미충족", "과열도 기준 밖")
      .replaceAll("5일 모멘텀 미충족", "최근 5일 흐름이 약함")
      .replace(/(\d+)일 모멘텀 미충족/g, "최근 $1일 흐름이 약함")
      .replaceAll("변동성 과다", "가격 흔들림이 큼")
      .replaceAll("배정 시드/현금 버퍼 부족", "설정한 투자금이 부족함")
      .replaceAll("이미 보유 중이라 추가매수 OFF", "이미 보유 중이라 추가매수 꺼짐")
      .replaceAll("추가매수 최소 간격 대기", "추가매수 간격을 기다리는 중")
      .replaceAll("당일 봇 손실 한도 도달, 방어 매도", "오늘 봇 손실 한도 도달로 방어 매도")
      .replaceAll("당일 봇 손실 한도 도달, 신규매수 중단", "오늘 봇 손실 한도 도달로 새 매수 중단")
      .replaceAll("상승 추세 + RSI 정상 + 5일 모멘텀 양호", "매수 조건 통과")
      .replace(/상승 추세 \+ RSI 정상 \+ \d+일 모멘텀 양호/g, "매수 조건 통과")
      .replaceAll("정규장 밖이면 소수점 금액 주문은 대기", "소수점 주문은 미국 정규장에만 가능")
      .replaceAll("정규장 밖이라 소수점 주문 대기, 1주 매수 예산 부족", "소수점 주문은 정규장에만 가능하고 1주 예산도 부족함")
      .replaceAll("장외 매도 가능한 정수 수량 없음", "소수점 보유분은 정규장에서 매도 대기")
      .replaceAll("20일선 이탈", "단기 상승 흐름 이탈")
      .replace(/(\d+)일선 이탈/g, "$1일 상승 흐름 이탈")
      .replaceAll("1차 익절", "일부 이익실현")
  );
}

function escapeHtml(value) {
  return value.replace(/[&<>"']/g, (char) => ({
    "&": "&amp;",
    "<": "&lt;",
    ">": "&gt;",
    '"': "&quot;",
    "'": "&#39;"
  })[char]);
}
