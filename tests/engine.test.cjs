const { test } = require("node:test");
const assert = require("node:assert/strict");
const E = require("../work-engine.js");
const from = "2026-11-09",
  now = "2026-11-09T06:00:00Z",
  base = { from, now, config: {}, meetings: [], sessions: [] };
const task = (id, remaining = 30, more = {}) =>
  E.task(
    {
      id,
      text: id,
      completed: false,
      remaining,
      estimated: remaining,
      ...more,
    },
    now,
  );
function validate(p, meetings = []) {
  const all = [...p.sessions, ...meetings].sort(
    (a, b) => Date.parse(a.start) - Date.parse(b.start),
  );
  for (let i = 1; i < all.length; i++)
    assert.ok(
      Date.parse(all[i].start) >= Date.parse(all[i - 1].end),
      "No overlaps",
    );
  assert.ok(p.used <= p.capacity - p.reserve + 0.001);
}
test("priorities: due, overdue, no date, explicit boss, source and equal duration", () => {
  const score = (t) => E.priority(t, [], {}, now).score;
  assert.ok(score(task("a", 30, { due: from })) > score(task("b")));
  assert.ok(
    score(task("a", 30, { due: "2026-11-06" })) >
      score(task("a", 30, { due: from })),
  );
  assert.ok(
    score(task("a", 30, { boss: true })) >
      score(task("a", 30, { origin: "Responsable" })),
  );
  assert.equal(score(task("a", 5)), score(task("b", 60)));
});
test("long tasks split, quick intact, reserve and meetings preserved", () => {
  const meetings = [
    { start: "2026-11-09T09:00:00Z", end: "2026-11-09T10:00:00Z" },
  ];
  const p = E.plan({
    ...base,
    meetings,
    tasks: [task("long", 300, { type: "Concentración" }), task("small", 15)],
  });
  validate(p, meetings);
  assert.ok(p.sessions.filter((s) => s.taskId === "long").length > 1);
  assert.equal(p.sessions.filter((s) => s.taskId === "small").length, 1);
  assert.ok(p.reserve > 0);
});
test("unavailable tasks never planned", () => {
  const p = E.plan({
    ...base,
    tasks: [
      task("done", 30, { completed: true }),
      task("cancel", 30, { status: "Cancelada" }),
      task("wait", 30, { status: "En espera" }),
      task("blocked", 30, { dependencies: ["missing"] }),
      task("future", 30, { startDate: "2026-11-10" }),
    ],
  });
  assert.equal(p.sessions.length, 0);
});
test("locked sessions are preserved in replanning and remaining duration not double booked", () => {
  const fixed = {
    id: "fixed",
    taskId: "long",
    start: "2026-11-09T08:00:00Z",
    end: "2026-11-09T09:00:00Z",
    locked: true,
    status: "accepted",
  };
  const p = E.plan({
    ...base,
    tasks: [task("long", 120, { type: "Concentración" })],
    sessions: [fixed],
    replan: true,
  });
  assert.equal(p.changes.length, 0);
  assert.equal(p.used, 60);
  validate(p, [fixed]);
});
test("overload and hard deadline return partial explained proposal", () => {
  const p = E.plan({
    ...base,
    tasks: [
      task("huge", 3000, { due: from, hardDue: true, type: "Concentración" }),
    ],
  });
  assert.ok(p.warnings.length);
  assert.ok(p.unscheduled.length);
  validate(p);
});
test("nonworking dates and absence have zero capacity", () => {
  assert.equal(
    E.plan({ ...base, from: "2026-11-08", tasks: [task("a")] }).capacity,
    0,
  );
  assert.equal(
    E.plan({
      ...base,
      config: { exceptions: { [from]: { off: true } } },
      tasks: [task("a")],
    }).capacity,
    0,
  );
});
test("determinism, no mutation, historical sessions preserved", () => {
  const args = {
    ...base,
    tasks: [task("b"), task("a")],
    sessions: [
      {
        id: "done",
        start: "2026-11-09T07:30:00Z",
        end: "2026-11-09T08:00:00Z",
        status: "done",
      },
    ],
  };
  const before = JSON.stringify(args);
  assert.deepEqual(E.plan(args), E.plan(args));
  assert.equal(JSON.stringify(args), before);
  assert.deepEqual(E.plan({ ...args, replan: true }).changes, []);
});
test("DST conversion uses configured timezone", () => {
  assert.equal(
    new Date(E.wall("2026-03-27", "08:30")).toISOString(),
    "2026-03-27T07:30:00.000Z",
  );
  assert.equal(
    new Date(E.wall("2026-03-30", "08:30")).toISOString(),
    "2026-03-30T06:30:00.000Z",
  );
  assert.equal(
    new Date(E.wall("2026-10-26", "08:30")).toISOString(),
    "2026-10-26T07:30:00.000Z",
  );
});
test("recurrence stable ids, monthly clipping and last business day", () => {
  const t = {
    id: "r",
    text: "Reporting",
    start: "2026-01-31",
    frequency: "Mensual",
    monthDay: 31,
  };
  const a = E.occurrences(t, "2026-02-01", 28);
  assert.equal(a[0].startDate, "2026-02-28");
  assert.deepEqual(a, E.occurrences(t, "2026-02-01", 28));
  assert.equal(
    E.occurrences({ ...t, lastWorkday: true }, "2026-02-01", 28)[0].startDate,
    "2026-02-27",
  );
});
test("daily weekly custom recurrences respect template start/end", () => {
  const t = { id: "r", text: "r", start: from, end: "2026-11-13" };
  assert.equal(
    E.occurrences({ ...t, frequency: "Diaria" }, from, 14).length,
    5,
  );
  assert.equal(
    E.occurrences({ ...t, frequency: "Semanal", weekdays: [1, 3] }, from, 14)
      .length,
    2,
  );
  assert.equal(
    E.occurrences({ ...t, frequency: "Personalizada", interval: 2 }, from, 14)
      .length,
    3,
  );
  assert.equal(E.occurrences({ ...t, active: false }, from, 14).length, 0);
});
test("settings reject invalid proportions and workday", () => {
  assert.throws(() => E.validateSettings(E.settings({ focus: 70 })));
  assert.throws(() => E.validateSettings(E.settings({ end: "07:00" })));
});
test("urgent uses free margin first and does not cancel stable sessions", () => {
  const sessions = [
    {
      id: "protected",
      taskId: "focus",
      start: "2026-11-09T08:00:00Z",
      end: "2026-11-09T09:00:00Z",
      status: "accepted",
      locked: false,
    },
  ];
  const p = E.plan({
    ...base,
    sessions,
    tasks: [
      task("focus", 60, { type: "Concentración" }),
      task("urgent", 45, { boss: true, manual: 2, due: from }),
    ],
    replan: true,
    urgent: true,
  });
  assert.equal(p.changes.length, 0);
  assert.ok(p.sessions.some((s) => s.taskId === "urgent"));
});
test("quick work is batched while retaining individual task identifiers", () => {
  const p = E.plan({
    ...base,
    tasks: [task("a", 15), task("b", 15), task("c", 15)],
  });
  assert.equal(new Set(p.sessions.map((s) => s.batchId)).size, 1);
  assert.equal(new Set(p.sessions.map((s) => s.taskId)).size, 3);
});
test("invalid dates and dependencies are reported as unplanned", () => {
  const p = E.plan({
    ...base,
    tasks: [task("blocked", 30, { dependencies: ["absent"] })],
  });
  assert.equal(p.unscheduled[0].reason, "Dependencias pendientes");
});
test("holidays reduce capacity and shift last working day", () => {
  const config = { holidays: ["2026-11-09", "2026-11-30"] };
  assert.equal(E.plan({ ...base, config, tasks: [task("a")] }).capacity, 0);
  const r = {
    id: "r",
    text: "Cierre",
    frequency: "Mensual",
    start: "2026-11-01",
    lastWorkday: true,
  };
  assert.equal(
    E.occurrences(r, "2026-11-01", 30, config)[0].startDate,
    "2026-11-27",
  );
});
test("preferred focus window is used when there is sufficient space", () => {
  const p = E.plan({
    ...base,
    tasks: [task("focus", 90, { type: "Concentración" })],
    config: { focusStart: "10:00", focusEnd: "12:00" },
  });
  assert.equal(
    new Date(p.sessions[0].start).toISOString(),
    "2026-11-09T09:00:00.000Z",
  );
  validate(p);
});
