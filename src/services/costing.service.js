function round4(n) {
  return Math.round((Number(n) + Number.EPSILON) * 10000) / 10000;
}

function round2(n) {
  return Math.round((Number(n) + Number.EPSILON) * 100) / 100;
}

function computeNewAvgCost(oldQty, oldAvg, purchaseQty, purchaseUnitCost) {
  const newQty = oldQty + purchaseQty;
  if (newQty <= 0) return 0;
  const totalValue = (oldQty * oldAvg) + (purchaseQty * purchaseUnitCost);
  return round4(totalValue / newQty);
}

module.exports = { round2, round4, computeNewAvgCost };
