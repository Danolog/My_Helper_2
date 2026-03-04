/**
 * MyHelper — K6 Load Test Suite
 *
 * Endpoints tested:
 *   GET  /api/appointments
 *   GET  /api/available-slots
 *   GET  /api/dashboard/stats
 *   GET  /api/reports/revenue
 *   GET  /api/clients
 *
 * Thresholds:
 *   p(95) < 200 ms
 *   p(99) < 500 ms
 *   error rate < 1 %
 *
 * Usage:
 *   k6 run tests/performance/load-test.js
 *   k6 run --env BASE_URL=https://myhelper.app tests/performance/load-test.js
 */

import http from "k6/http";
import { check, group, sleep } from "k6";
import { Rate, Trend } from "k6/metrics";

// ─── Custom metrics ──────────────────────────────────────────────────────────
const errorRate = new Rate("errors");
const appointmentsDuration = new Trend("appointments_duration", true);
const availableSlotsDuration = new Trend("available_slots_duration", true);
const dashboardStatsDuration = new Trend("dashboard_stats_duration", true);
const revenueReportDuration = new Trend("revenue_report_duration", true);
const clientsDuration = new Trend("clients_duration", true);

// ─── Configuration ───────────────────────────────────────────────────────────
const BASE_URL = __ENV.BASE_URL || "http://localhost:3000";

// Auth cookie/token — set via environment or replace with a valid session
const AUTH_COOKIE = __ENV.AUTH_COOKIE || "";

// Salon ID used for scoped queries
const SALON_ID = __ENV.SALON_ID || "test-salon-id";

// ─── K6 Options ──────────────────────────────────────────────────────────────
export const options = {
  scenarios: {
    // Smoke test — verify endpoints work
    smoke: {
      executor: "constant-vus",
      vus: 1,
      duration: "30s",
      startTime: "0s",
      tags: { scenario: "smoke" },
    },
    // Load test — normal traffic
    load: {
      executor: "ramping-vus",
      startVUs: 0,
      stages: [
        { duration: "1m", target: 20 },  // ramp up
        { duration: "3m", target: 20 },  // steady state
        { duration: "1m", target: 50 },  // peak
        { duration: "2m", target: 50 },  // sustain peak
        { duration: "1m", target: 0 },   // ramp down
      ],
      startTime: "30s",
      tags: { scenario: "load" },
    },
    // Stress test — find breaking point
    stress: {
      executor: "ramping-vus",
      startVUs: 0,
      stages: [
        { duration: "1m", target: 50 },
        { duration: "2m", target: 100 },
        { duration: "2m", target: 150 },
        { duration: "1m", target: 0 },
      ],
      startTime: "9m",
      tags: { scenario: "stress" },
    },
  },
  thresholds: {
    // Global thresholds
    http_req_duration: ["p(95)<200", "p(99)<500"],
    errors: ["rate<0.01"],

    // Per-endpoint thresholds
    appointments_duration: ["p(95)<200", "p(99)<500"],
    available_slots_duration: ["p(95)<200", "p(99)<500"],
    dashboard_stats_duration: ["p(95)<200", "p(99)<500"],
    revenue_report_duration: ["p(95)<300", "p(99)<500"],
    clients_duration: ["p(95)<200", "p(99)<500"],
  },
};

// ─── Helpers ─────────────────────────────────────────────────────────────────
function getHeaders() {
  const headers = {
    "Content-Type": "application/json",
    Accept: "application/json",
  };
  if (AUTH_COOKIE) {
    headers["Cookie"] = AUTH_COOKIE;
  }
  return headers;
}

function checkResponse(res, name, customDuration) {
  const success = check(res, {
    [`${name} — status 200`]: (r) => r.status === 200,
    [`${name} — response time < 500ms`]: (r) => r.timings.duration < 500,
    [`${name} — valid JSON`]: (r) => {
      try {
        JSON.parse(r.body);
        return true;
      } catch {
        return false;
      }
    },
  });

  errorRate.add(!success);
  if (customDuration) {
    customDuration.add(res.timings.duration);
  }

  return success;
}

// ─── Scenario: Default function ──────────────────────────────────────────────
export default function () {
  const headers = getHeaders();
  const today = new Date().toISOString().split("T")[0];
  const monthStart = `${today.slice(0, 7)}-01`;
  const monthEnd = today;

  // ── GET /api/appointments ────────────────────────────────────────────────
  group("GET /api/appointments", () => {
    const res = http.get(
      `${BASE_URL}/api/appointments?salonId=${SALON_ID}&date=${today}`,
      { headers, tags: { endpoint: "appointments" } }
    );
    checkResponse(res, "appointments", appointmentsDuration);
  });

  sleep(0.5);

  // ── GET /api/available-slots ─────────────────────────────────────────────
  group("GET /api/available-slots", () => {
    const res = http.get(
      `${BASE_URL}/api/available-slots?salonId=${SALON_ID}&date=${today}&serviceId=test-service-id`,
      { headers, tags: { endpoint: "available-slots" } }
    );
    checkResponse(res, "available-slots", availableSlotsDuration);
  });

  sleep(0.5);

  // ── GET /api/dashboard/stats ─────────────────────────────────────────────
  group("GET /api/dashboard/stats", () => {
    const res = http.get(
      `${BASE_URL}/api/dashboard/stats?salonId=${SALON_ID}`,
      { headers, tags: { endpoint: "dashboard-stats" } }
    );
    checkResponse(res, "dashboard-stats", dashboardStatsDuration);
  });

  sleep(0.5);

  // ── GET /api/reports/revenue ─────────────────────────────────────────────
  group("GET /api/reports/revenue", () => {
    const res = http.get(
      `${BASE_URL}/api/reports/revenue?salonId=${SALON_ID}&startDate=${monthStart}&endDate=${monthEnd}`,
      { headers, tags: { endpoint: "revenue-report" } }
    );
    checkResponse(res, "revenue-report", revenueReportDuration);
  });

  sleep(0.5);

  // ── GET /api/clients ─────────────────────────────────────────────────────
  group("GET /api/clients", () => {
    const res = http.get(
      `${BASE_URL}/api/clients?salonId=${SALON_ID}&page=1&limit=20`,
      { headers, tags: { endpoint: "clients" } }
    );
    checkResponse(res, "clients", clientsDuration);
  });

  sleep(1);
}

// ─── Setup — optional warm-up request ────────────────────────────────────────
export function setup() {
  const headers = getHeaders();
  const res = http.get(`${BASE_URL}/api/health`, { headers });

  if (res.status !== 200) {
    console.warn(
      `⚠️  Health check returned ${res.status}. Server may not be ready.`
    );
  }

  return { baseUrl: BASE_URL, salonId: SALON_ID };
}

// ─── Teardown — summary ─────────────────────────────────────────────────────
export function teardown(data) {
  console.log(`\n✅ Load test complete against ${data.baseUrl}`);
}
