/* Pure business rules; shared by the browser and node:test. */
(function (root) {
  "use strict";
  const defaults = {
    timezone: "Europe/Madrid",
    start: "08:30",
    end: "17:30",
    breaks: [{ start: "14:00", end: "14:30" }],
    weekdays: [1, 2, 3, 4, 5],
    exceptions: {},
    holidays: [],
    targetHours: 8,
    focusStart: "09:00",
    focusEnd: "12:00",
    focus: 50,
    quick: 30,
    reserve: 20,
    session: 90,
    minimum: 15,
    quickLimit: 60,
    urgency: { overdue: 40, today: 35, tomorrow: 30, soon: 20, week: 10 },
    weights: { deadline: 40, boss: 25, impact: 20, dependencies: 10, age: 5 },
    maxFileMB: 50,
    extensions: [
      "pdf",
      "xlsx",
      "xlsb",
      "docx",
      "pptx",
      "xls",
      "doc",
      "ppt",
      "txt",
      "csv",
      "png",
      "jpg",
      "jpeg",
      "webp",
      "zip",
    ],
  };
  const clone = (x) => JSON.parse(JSON.stringify(x));
  const dayAdd = (d, n) =>
    new Date(Date.parse(d + "T12:00:00Z") + n * 86400000)
      .toISOString()
      .slice(0, 10);
  const weekday = (d) => new Date(d + "T12:00:00Z").getUTCDay();
  function dateAt(instant, zone = defaults.timezone) {
    return new Intl.DateTimeFormat("en-CA", {
      timeZone: zone,
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
    }).format(new Date(instant));
  }
  function wall(date, time, zone = defaults.timezone) {
    const target = Date.parse(`${date}T${time}:00Z`);
    let value = target;
    for (let i = 0; i < 4; i++) {
      const parts = Object.fromEntries(
        new Intl.DateTimeFormat("en-CA", {
          timeZone: zone,
          year: "numeric",
          month: "2-digit",
          day: "2-digit",
          hour: "2-digit",
          minute: "2-digit",
          second: "2-digit",
          hourCycle: "h23",
        })
          .formatToParts(new Date(value))
          .map((p) => [p.type, p.value]),
      );
      const represented = Date.parse(
        `${parts.year}-${parts.month}-${parts.day}T${parts.hour}:${parts.minute}:${parts.second}Z`,
      );
      const delta = target - represented;
      if (!delta) return value;
      value += delta;
    }
    throw Error("Hora local inexistente por cambio de horario.");
  }
  function settings(s = {}) {
    return {
      ...clone(defaults),
      ...s,
      weights: { ...defaults.weights, ...s.weights },
      urgency: { ...defaults.urgency, ...s.urgency },
    };
  }
  function task(t, now = new Date().toISOString()) {
    return {
      completed: false,
      createdAt: now,
      status: t.completed ? "Completada" : "Bandeja de entrada",
      type: "Rápida",
      estimated: 30,
      remaining: 30,
      actual: 0,
      timeEntries: [],
      impact: 3,
      manual: 0,
      boss: false,
      dependencies: [],
      tags: [],
      comments: [],
      checklist: [],
      documents: "",
      versions: [],
      attachments: [],
      history: [],
      ...t,
    };
  }
  function workspace(w = {}) {
    return {
      version: 2,
      projects: [],
      sessions: [],
      proposals: [],
      recurrences: [],
      history: [],
      ...clone(w),
      settings: settings(w.settings),
    };
  }
  const isWorkday = (d, s) =>
    !s.holidays.includes(d) &&
    s.exceptions[d]?.off !== true &&
    (s.exceptions[d]?.start || s.weekdays.includes(weekday(d)));
  function businessDistance(a, b, s) {
    let n = 0;
    for (let d = a; d < b && n < 366; d = dayAdd(d, 1))
      if (isWorkday(dayAdd(d, 1), s)) n++;
    return n;
  }
  function priority(t, all, config = {}, now = new Date().toISOString()) {
    const s = settings(config),
      today = dateAt(now, s.timezone),
      distance = t.due ? businessDistance(today, t.due, s) : 999;
    const urgency = !t.due
      ? 0
      : t.due < today
        ? s.urgency.overdue
        : t.due === today
          ? s.urgency.today
          : distance <= 1
            ? s.urgency.tomorrow
            : distance <= 3
              ? s.urgency.soon
              : distance <= 5
                ? s.urgency.week
                : 0;
    const reasons = {
      deadline: (urgency / 40) * s.weights.deadline,
      boss:
        (t.boss ? 1 : t.origin === "Responsable" ? 0.2 : 0) * s.weights.boss,
      impact:
        (Math.min(5, Math.max(0, +t.impact || 0, +t.projectPriority || 0)) /
          5) *
        s.weights.impact,
      dependencies:
        (all.some((a) => (a.dependencies || []).includes(t.id) && !a.completed)
          ? 1
          : 0) * s.weights.dependencies,
      age:
        Math.min(
          1,
          Math.max(
            0,
            (Date.parse(now) - Date.parse(t.createdAt || now)) / 86400000 / 30,
          ),
        ) * s.weights.age,
    };
    const total = Object.values(s.weights).reduce((a, b) => a + b, 0) || 100;
    return {
      score: Math.min(
        100,
        Math.round(
          (Object.values(reasons).reduce((a, b) => a + b, 0) * 100) / total,
        ),
      ),
      reasons,
    };
  }
  function subtract(slots, busy) {
    let out = slots;
    for (const b of busy) {
      const start = +new Date(b.start),
        end = +new Date(b.end);
      out = out.flatMap(([a, z]) =>
        end <= a || start >= z
          ? [[a, z]]
          : [
              [a, Math.min(start, z)],
              [Math.max(end, a), z],
            ].filter(([x, y]) => y > x),
      );
    }
    return out;
  }
  function availability(date, s, meetings = [], sessions = [], now = 0) {
    s = settings(s);
    if (!isWorkday(date, s)) return [];
    const rule = { ...s, ...s.exceptions[date] };
    const start = Math.max(
        wall(date, rule.start, s.timezone),
        +new Date(now) || 0,
      ),
      end = wall(date, rule.end, s.timezone);
    if (end <= start) return [];
    const breaks = (rule.breaks || []).map((b) => ({
      start: wall(date, b.start, s.timezone),
      end: wall(date, b.end, s.timezone),
    }));
    return subtract(
      [[start, end]],
      [
        ...breaks,
        ...meetings,
        ...sessions.filter((x) => x.status !== "cancelled"),
      ],
    );
  }
  const mins = (slots) => slots.reduce((n, [a, b]) => n + (b - a) / 60000, 0);
  function plan({
    from,
    days = 1,
    tasks: raw,
    meetings = [],
    sessions = [],
    config = {},
    now = new Date().toISOString(),
    replan = false,
    urgent = false,
  }) {
    if (replan && urgent) {
      const stable = plan({
        from,
        days,
        tasks: raw,
        meetings,
        sessions,
        config,
        now,
        replan: false,
        urgent: true,
      });
      const critical = raw.filter(
        (t) => !t.completed && (t.boss || t.manual === 2 || t.hardDue),
      );
      if (
        !stable.unscheduled.some((u) => critical.some((t) => t.id === u.taskId))
      )
        return stable;
    }
    const s = settings(config),
      all = raw.map((t) => task(t, now)),
      until = dayAdd(from, days),
      old = sessions.filter((x) => x.status !== "cancelled");
    const inRange = (x) =>
      dateAt(x.start, s.timezone) >= from &&
      dateAt(x.start, s.timezone) < until;
    const movable = old.filter(
      (x) =>
        replan &&
        inRange(x) &&
        !x.locked &&
        x.status === "accepted" &&
        Date.parse(x.start) > Date.parse(now),
    );
    const fixed = old.filter((x) => !movable.includes(x));
    const slots = [];
    let capacity = 0,
      reserve = 0;
    for (let i = 0; i < days; i++) {
      const d = dayAdd(from, i),
        free = availability(
          d,
          s,
          meetings,
          fixed,
          Math.ceil((Date.parse(now) + 60000) / 300000) * 300000,
        ),
        net = mins(free);
      capacity += net;
      let keep = urgent ? 0 : (net * s.reserve) / 100;
      reserve += keep;
      for (let j = free.length - 1; j >= 0; j--) {
        const amount = Math.min(keep, (free[j][1] - free[j][0]) / 60000);
        free[j][1] -= amount * 60000;
        keep -= amount;
      }
      slots.push(...free.filter(([a, b]) => b > a));
    }
    let available = slots,
      proposed = [],
      unscheduled = [],
      warnings = [];
    const remaining = new Map(
      all.map((t) => [
        t.id,
        Math.max(
          0,
          t.remaining -
            fixed
              .filter(
                (x) =>
                  x.taskId === t.id &&
                  ["accepted", "running", "paused"].includes(x.status),
              )
              .reduce(
                (n, x) => n + (Date.parse(x.end) - Date.parse(x.start)) / 60000,
                0,
              ),
        ),
      ]),
    );
    const eligible = all.filter(
      (t) =>
        !t.completed &&
        !t.archived &&
        !["Completada", "Cancelada", "En espera"].includes(t.status) &&
        !t.dependencies.some((id) => !all.find((a) => a.id === id)?.completed),
    );
    function slack(t) {
      if (!t.due) return Infinity;
      return (
        mins(available.filter(([a]) => dateAt(a, s.timezone) <= t.due)) -
        (remaining.get(t.id) || 0)
      );
    }
    const score = (t) => priority(t, all, s, now).score;
    eligible.sort(
      (a, b) =>
        Number(!!b.hardDue) - Number(!!a.hardDue) ||
        Math.min(0, slack(a)) - Math.min(0, slack(b)) ||
        (+b.manual || 0) - (+a.manual || 0) ||
        score(b) - score(a) ||
        String(a.id).localeCompare(String(b.id)),
    );
    // Interleave the two queues by target share; deadlines at risk always lead.
    let focusUsed = 0,
      quickUsed = 0;
    while (eligible.length) {
      let index = 0;
      const first = eligible[0];
      if (!first.hardDue && slack(first) > 0) {
        const preferFocus =
          focusUsed / (s.focus || 1) <= quickUsed / (s.quick || 1);
        const match = eligible.findIndex(
          (t) => (t.type === "Concentración") === preferFocus,
        );
        if (match >= 0) index = match;
      }
      const t = eligible.splice(index, 1)[0];
      let left = remaining.get(t.id);
      const isQuick = t.type !== "Concentración" && left <= s.quickLimit;
      while (left > 0) {
        // Try preferred concentration windows first, retaining other slots as fallback.
        const candidates =
          !isQuick && s.focusStart && s.focusEnd
            ? [
                ...available
                  .map(([a, b]) => [
                    Math.max(
                      a,
                      wall(dateAt(a, s.timezone), s.focusStart, s.timezone),
                    ),
                    Math.min(
                      b,
                      wall(dateAt(a, s.timezone), s.focusEnd, s.timezone),
                    ),
                  ])
                  .filter(
                    ([a, b]) => (b - a) / 60000 >= Math.min(left, s.session),
                  ),
                ...available,
              ]
            : available;
        let candidate = -1,
          begin = 0,
          length = 0;
        for (let i = 0; i < candidates.length; i++) {
          const [a, b] = candidates[i];
          const start = Math.max(
            a,
            t.startDate ? wall(t.startDate, "00:00", s.timezone) : a,
          );
          const end = Math.min(
            b,
            t.due ? wall(dayAdd(t.due, 1), "00:00", s.timezone) : b,
          );
          const fit = Math.floor((end - start) / 60000);
          const wanted = isQuick ? left : Math.min(left, s.session);
          if (
            fit > 0 &&
            (isQuick ? fit >= left : fit >= Math.min(left, s.minimum))
          ) {
            candidate = i;
            begin = start;
            length = Math.min(wanted, fit);
            break;
          }
        }
        if (candidate < 0) break;
        // Reuse an existing time when it still fits the same constraints.
        const previousSlot = movable.find(
          (x) =>
            x.taskId === t.id &&
            available.some(
              ([a, b]) => Date.parse(x.start) >= a && Date.parse(x.end) <= b,
            ) &&
            (!t.startDate || dateAt(x.start, s.timezone) >= t.startDate) &&
            (!t.due || dateAt(x.end, s.timezone) <= t.due),
        );
        if (previousSlot) {
          const duration =
            (Date.parse(previousSlot.end) - Date.parse(previousSlot.start)) /
            60000;
          if (duration <= left && (!isQuick || duration === left)) {
            begin = Date.parse(previousSlot.start);
            length = duration;
          }
        }
        const finish = begin + length * 60000;
        const previous = movable.find(
          (x) =>
            x.taskId === t.id &&
            Date.parse(x.start) === begin &&
            Date.parse(x.end) === finish,
        );
        const item = {
          id:
            previous?.id || `session:${t.id}:${new Date(begin).toISOString()}`,
          taskId: t.id,
          start: new Date(begin).toISOString(),
          end: new Date(finish).toISOString(),
          status: "proposed",
          locked: false,
          kind: isQuick ? "quick" : "focus",
        };
        proposed.push(item);
        available = subtract(available, [item]);
        left -= length;
        if (isQuick) quickUsed += length;
        else focusUsed += length;
      }
      if (left > 0) {
        unscheduled.push({
          taskId: t.id,
          minutes: left,
          reason: t.due
            ? "No cabe antes del vencimiento"
            : "Capacidad insuficiente",
        });
        if (t.due)
          warnings.push(`${t.text}: faltan ${left} min antes de ${t.due}.`);
      }
    }
    for (const t of all.filter(
      (t) =>
        !t.completed &&
        !t.archived &&
        !eligible.includes(t) &&
        t.status === "En espera",
    ))
      unscheduled.push({
        taskId: t.id,
        minutes: t.remaining,
        reason: "En espera de terceros",
      });
    // Adjacent quick tasks form an explicit batch of at most 60 minutes.
    let batch = null;
    for (const session of [...proposed].sort(
      (a, b) => Date.parse(a.start) - Date.parse(b.start),
    )) {
      const duration =
        (Date.parse(session.end) - Date.parse(session.start)) / 60000;
      if (session.kind !== "quick") {
        batch = null;
        continue;
      }
      if (
        !batch ||
        batch.end !== session.start ||
        batch.minutes + duration > 60
      )
        batch = { id: `batch:${session.id}`, minutes: 0, end: session.start };
      session.batchId = batch.id;
      batch.minutes += duration;
      batch.end = session.end;
    }
    for (const t of all.filter(
      (t) =>
        !t.completed &&
        !t.archived &&
        t.status !== "En espera" &&
        t.status !== "Cancelada" &&
        t.dependencies.some((id) => !all.find((a) => a.id === id)?.completed),
    ))
      unscheduled.push({
        taskId: t.id,
        minutes: t.remaining,
        reason: "Dependencias pendientes",
      });
    const changes = movable
      .filter((x) => !proposed.some((p) => p.id === x.id))
      .map((x) => ({
        id: x.id,
        taskId: x.taskId,
        start: x.start,
        action: "cancel",
      }));
    const used = proposed.reduce(
      (n, x) => n + (Date.parse(x.end) - Date.parse(x.start)) / 60000,
      0,
    );
    if (urgent)
      warnings.push(
        "La propuesta utiliza el margen de imprevistos; requiere aceptación.",
      );
    return {
      from,
      days,
      createdAt: now,
      status: "proposed",
      sessions: proposed,
      changes,
      capacity,
      used,
      reserve,
      free: capacity - used,
      unscheduled,
      warnings,
      signature: JSON.stringify({ raw, meetings, sessions, config }),
    };
  }
  function occurrences(template, from, days, config = {}) {
    const s = settings(config),
      result = [];
    if (template.active === false) return result;
    for (let i = 0; i < days; i++) {
      const d = dayAdd(from, i);
      if (d < template.start || (template.end && d > template.end)) continue;
      const delta = Math.round(
          (Date.parse(d) - Date.parse(template.start)) / 86400000,
        ),
        week = weekday(d),
        last =
          new Date(Date.parse(dayAdd(d, 1) + "T12:00:00Z")).getUTCMonth() !==
          new Date(d + "T12:00:00Z").getUTCMonth();
      let matches =
        template.frequency === "Diaria"
          ? isWorkday(d, s)
          : template.frequency === "Semanal"
            ? (template.weekdays || [weekday(template.start)]).includes(week)
            : template.frequency === "Personalizada"
              ? delta % (template.interval || 1) === 0
              : false;
      if (template.frequency === "Mensual") {
        if (template.lastWorkday) {
          let next = dayAdd(d, 1);
          while (!isWorkday(next, s)) next = dayAdd(next, 1);
          matches = isWorkday(d, s) && next.slice(0, 7) !== d.slice(0, 7);
        } else
          matches =
            +d.slice(-2) ===
              (+template.monthDay || +template.start.slice(-2)) ||
            (last &&
              (+template.monthDay || +template.start.slice(-2)) > +d.slice(-2));
      }
      if (matches)
        result.push(
          task(
            {
              id: `recurrence:${template.id}:${d}`,
              text: template.text,
              estimated: template.estimated || 30,
              remaining: template.estimated || 30,
              type: "Recurrente",
              startDate: d,
              due: dayAdd(d, +template.dueOffset || 0),
              projectId: template.projectId,
              recurrenceId: template.id,
              documents: template.documents || "",
              checklist: clone(template.checklist || []),
              attachments: clone(template.attachments || []),
              manual: +template.manual || 0,
            },
            d + "T12:00:00Z",
          ),
        );
    }
    return result;
  }
  function validateSettings(s) {
    settings(s);
    for (const key of ["session", "minimum", "quickLimit", "targetHours"])
      if (!Number.isFinite(s[key]) || s[key] <= 0)
        throw Error("Duraciones de configuración no válidas.");
    new Intl.DateTimeFormat("es", { timeZone: s.timezone });
    if (s.focusStart && s.focusEnd && s.focusEnd <= s.focusStart)
      throw Error("Revisa la franja de concentración.");
    if (s.end <= s.start) throw Error("El fin debe ser posterior al inicio.");
    if (s.focus + s.quick + s.reserve !== 100)
      throw Error("Los porcentajes deben sumar 100.");
    if (!s.weekdays.length)
      throw Error("Selecciona al menos un día laborable.");
    for (const b of s.breaks)
      if (b.end <= b.start) throw Error("Descanso inválido.");
  }
  root.WorkEngine = {
    defaults,
    settings,
    workspace,
    task,
    dateAt,
    wall,
    dayAdd,
    weekday,
    priority,
    subtract,
    availability,
    plan,
    occurrences,
    validateSettings,
  };
  if (typeof module !== "undefined") module.exports = root.WorkEngine;
})(globalThis);
