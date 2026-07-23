/**
 * Vendor slot plans (monthly).
 * Free = claim key; Standard / Boost = crypto payment (no middleman).
 */

const PLANS = {
  free: {
    id: "free",
    name: "Free",
    priceEur: 0,
    days: 30,
    everyonePings: 1,
    herePings: 1,
    paid: false,
  },
  standard: {
    id: "standard",
    name: "Standard",
    priceEur: 1.5,
    days: 30,
    everyonePings: 1,
    herePings: 2,
    paid: true,
  },
  boost: {
    id: "boost",
    name: "Boost",
    priceEur: 4,
    days: 30,
    everyonePings: 2,
    herePings: 3,
    paid: true,
  },
};

const PAID_PLAN_IDS = ["standard", "boost"];

function getPlan(planId) {
  const id = String(planId || "").trim().toLowerCase();
  return PLANS[id] || null;
}

function isPaidPlan(planId) {
  const plan = getPlan(planId);
  return Boolean(plan?.paid);
}

module.exports = {
  PLANS,
  PAID_PLAN_IDS,
  getPlan,
  isPaidPlan,
};
