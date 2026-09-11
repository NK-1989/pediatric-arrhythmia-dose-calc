// 体重・薬剤データから実際に投与する数値（mL / mg / J / mL/時 など）を計算する。
// 端数処理は薬剤ごとに指定された方向（切り上げ／切り下げ）で行い、
// 「シリンジで実際に引きやすい・現場で扱いやすい」数値になることを優先する。
// 丸めた結果、実際に投与される量は標準投与量（体重×mg/kg等）から必然的にずれるため、
// そのずれを％表示し、10％を超える場合は警告する（検算用）。

const DEVIATION_WARNING_PERCENT = 10;

/**
 * 値を指定ステップ単位で切り上げ／切り下げする。
 * @param {number} raw 生の計算値
 * @param {number} step 丸め単位（例: 0.1）
 * @param {'up'|'down'} direction 丸め方向
 */
function roundToStep(raw, step, direction) {
  if (!isFinite(raw)) return raw;
  if (raw <= 0) return 0;
  const scaled = raw / step;
  let rounded = direction === 'up' ? Math.ceil(scaled - 1e-9) : Math.floor(scaled + 1e-9);
  // 「切り下げ」で0になってしまう場合、実際には投与量が0ではないため
  // 計量可能な最小単位（step）まで繰り上げる（0mLという非現実的な表示を避ける）
  if (rounded <= 0) rounded = 1;
  // 浮動小数点誤差対策で小数第4位で丸める
  return Math.round(rounded * step * 10000) / 10000;
}

/**
 * 標準値(target)に対する丸め後の実際値(actual)のずれを％で返す。
 * target が 0 の場合は計算不能として null を返す。
 */
function calcDeviationPercent(actual, target) {
  if (!target) return null;
  return ((actual - target) / target) * 100;
}

/**
 * mg/kg（単一値 or 範囲）の薬剤を計算する。
 * 戻り値: {
 *   doseMgLow, doseMgHigh,             // 標準投与量（体重×mg/kg、上限があれば頭打ち後）＝検算の基準値
 *   volumeMlLow, volumeMlHigh,         // 丸め後に実際に吸う量(mL)
 *   actualMgLow, actualMgHigh,         // 丸めた量から逆算した実際投与量(mg)
 *   deviationPercentLow, deviationPercentHigh, // 標準投与量からのずれ(％)
 *   deviationWarnLow, deviationWarnHigh,       // |ずれ| が10％を超えるか
 *   cappedByMax,
 * }
 */
function calcMgPerKgDrug(item, weightKg) {
  const lowPerKg = item.dosePerKg != null ? item.dosePerKg : item.doseMinPerKg;
  const highPerKg = item.dosePerKg != null ? item.dosePerKg : item.doseMaxPerKg;

  let doseMgLow = lowPerKg * weightKg;
  let doseMgHigh = highPerKg * weightKg;
  let cappedByMax = false;

  if (item.maxDoseMg != null) {
    if (doseMgLow > item.maxDoseMg) { doseMgLow = item.maxDoseMg; cappedByMax = true; }
    if (doseMgHigh > item.maxDoseMg) { doseMgHigh = item.maxDoseMg; cappedByMax = true; }
  }

  const step = item.round?.step ?? 0.1;
  const direction = item.round?.direction ?? 'down';

  const volumeMlLowRaw = doseMgLow / item.concMgPerMl;
  const volumeMlHighRaw = doseMgHigh / item.concMgPerMl;

  const volumeMlLow = roundToStep(volumeMlLowRaw, step, direction);
  const volumeMlHigh = roundToStep(volumeMlHighRaw, step, direction);

  const actualMgLow = volumeMlLow * item.concMgPerMl;
  const actualMgHigh = volumeMlHigh * item.concMgPerMl;

  const deviationPercentLow = calcDeviationPercent(actualMgLow, doseMgLow);
  const deviationPercentHigh = calcDeviationPercent(actualMgHigh, doseMgHigh);

  return {
    doseMgLow, doseMgHigh,
    volumeMlLow, volumeMlHigh,
    actualMgLow, actualMgHigh,
    deviationPercentLow, deviationPercentHigh,
    deviationWarnLow: deviationPercentLow != null && Math.abs(deviationPercentLow) > DEVIATION_WARNING_PERCENT,
    deviationWarnHigh: deviationPercentHigh != null && Math.abs(deviationPercentHigh) > DEVIATION_WARNING_PERCENT,
    cappedByMax,
  };
}

/**
 * J/kg（除細動等）を計算する。
 */
function calcJoulePerKg(item, weightKg) {
  const lowPerKg = item.dosePerKg != null ? item.dosePerKg : item.doseMinPerKg;
  const highPerKg = item.dosePerKg != null ? item.dosePerKg : item.doseMaxPerKg;

  const step = item.round?.step ?? 1;
  const direction = item.round?.direction ?? 'up';

  const targetLow = lowPerKg * weightKg;
  const targetHigh = highPerKg * weightKg;

  const joulesLow = roundToStep(targetLow, step, direction);
  const joulesHigh = roundToStep(targetHigh, step, direction);

  const deviationPercentLow = calcDeviationPercent(joulesLow, targetLow);
  const deviationPercentHigh = calcDeviationPercent(joulesHigh, targetHigh);

  return {
    targetLow, targetHigh,
    joulesLow, joulesHigh,
    deviationPercentLow, deviationPercentHigh,
    deviationWarnLow: deviationPercentLow != null && Math.abs(deviationPercentLow) > DEVIATION_WARNING_PERCENT,
    deviationWarnHigh: deviationPercentHigh != null && Math.abs(deviationPercentHigh) > DEVIATION_WARNING_PERCENT,
  };
}

/**
 * 持続静注（mcg/kg/分）の投与速度（mL/時）を計算する。
 * rate(mL/hr) = dose(mcg/kg/min) * weight(kg) * 60 / concentration(mcg/mL)
 */
function calcInfusionRate(item, weightKg) {
  const lowPerKgMin = item.dosePerKg != null ? item.dosePerKg : item.doseMinPerKg;
  const highPerKgMin = item.dosePerKg != null ? item.dosePerKg : item.doseMaxPerKg;

  const step = item.round?.step ?? 0.1;
  const direction = item.round?.direction ?? 'down';

  const rateLowRaw = (lowPerKgMin * weightKg * 60) / item.concMcgPerMl;
  const rateHighRaw = (highPerKgMin * weightKg * 60) / item.concMcgPerMl;

  const rateMlHrLow = roundToStep(rateLowRaw, step, direction);
  const rateMlHrHigh = roundToStep(rateHighRaw, step, direction);

  const deviationPercentLow = calcDeviationPercent(rateMlHrLow, rateLowRaw);
  const deviationPercentHigh = calcDeviationPercent(rateMlHrHigh, rateHighRaw);

  return {
    rateMlHrLow, rateMlHrHigh,
    deviationPercentLow, deviationPercentHigh,
    deviationWarnLow: deviationPercentLow != null && Math.abs(deviationPercentLow) > DEVIATION_WARNING_PERCENT,
    deviationWarnHigh: deviationPercentHigh != null && Math.abs(deviationPercentHigh) > DEVIATION_WARNING_PERCENT,
  };
}

/**
 * 薬剤/手技アイテム1件を計算し、表示用の結果オブジェクトを返す。
 */
function calcItem(item, weightKg) {
  if (item.kind === 'procedure' && item.doseType === 'joulePerKg') {
    return { type: 'joule', ...calcJoulePerKg(item, weightKg) };
  }
  if (item.kind === 'drug' && item.doseType === 'mgPerKg') {
    return { type: 'mg', ...calcMgPerKgDrug(item, weightKg) };
  }
  if (item.kind === 'infusion' && item.doseType === 'mcgPerKgMin') {
    return { type: 'infusion', ...calcInfusionRate(item, weightKg) };
  }
  return { type: 'none' };
}

if (typeof module !== 'undefined' && module.exports) {
  module.exports = {
    DEVIATION_WARNING_PERCENT,
    roundToStep, calcDeviationPercent,
    calcMgPerKgDrug, calcJoulePerKg, calcInfusionRate, calcItem,
  };
}
