// EPIC-001 · @QA · Pruebas de performance para reorder
// Uso: k6 run tests/perf/reorder.k6.js

import http from 'k6/http'
import { check, sleep } from 'k6'

export const options = {
  stages: [
    { duration: '30s', target: 10 },   // warm-up
    { duration: '1m', target: 50 },    // pico suave
    { duration: '30s', target: 0 },    // cool-down
  ],
  thresholds: {
    http_req_duration: ['p(95) < 300', 'p(99) < 600'],
    http_req_failed: ['rate < 0.005'],
  },
}

const BASE = __ENV.BASE_URL || 'http://localhost:3000'
const TASKS = (__ENV.TASK_IDS || '').split(',').filter(Boolean)

export default function () {
  if (TASKS.length < 3) return

  const [a, b, c] = TASKS.slice(0, 3)
  const res = http.post(
    `${BASE}/api/tasks/reorder`,
    JSON.stringify({ taskId: a, beforeId: b, afterId: c }),
    { headers: { 'Content-Type': 'application/json' } },
  )

  check(res, {
    '200': (r) => r.status === 200,
    'p95 budget': (r) => r.timings.duration < 300,
  })
  sleep(0.1)
}
