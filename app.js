const storageKey = "planificador-tareas-v1";
const meetingStorageKey = "planificador-reuniones-v1";
const cloudBaseStoragePrefix = "planificador-cloud-base-v1:";
const cloudConfig = globalThis.PLANNER_CLOUD_CONFIG ?? {};

const form = document.querySelector("#task-form");
const input = document.querySelector("#task-input");
const list = document.querySelector("#task-list");
const count = document.querySelector("#task-count");
const emptyState = document.querySelector("#empty-state");
const clearCompletedButton = document.querySelector("#clear-completed");
const resetAllButton = document.querySelector("#reset-all");
const importCalendarButton = document.querySelector("#import-calendar");
const calendarInput = document.querySelector("#calendar-input");
const removeCalendarButton = document.querySelector("#remove-calendar");
const meetingCount = document.querySelector("#meeting-count");
const meetingList = document.querySelector("#meeting-list");
const meetingEmpty = document.querySelector("#meeting-empty");
const calendarStatus = document.querySelector("#calendar-status");
const calendarGrid = document.querySelector("#calendar-grid");
const calendarPeriod = document.querySelector("#calendar-period");
const selectedDateLabel = document.querySelector("#selected-date");
const previousCalendarButton = document.querySelector("#calendar-previous");
const todayCalendarButton = document.querySelector("#calendar-today");
const nextCalendarButton = document.querySelector("#calendar-next");
const plannerViewButtons = document.querySelectorAll("[data-planner-view]");
const announcements = document.querySelector("#announcements");
const plannerContent = document.querySelector("#planner-content");
const tasksView = document.querySelector("#task-view");
const calendarViewSection = document.querySelector("#calendar-view");
const pageTitle = document.querySelector("#page-title");
const optionsMenu = document.querySelector("#options-menu");
const plannerOptions = document.querySelector("#planner-options");
const cloudStatus = document.querySelector("#cloud-status");
const githubLoginButton = document.querySelector("#github-login");
const githubLogoutButton = document.querySelector("#github-logout");

let tasks = loadTasks();
let meetingCalendar = loadMeetingCalendar();
let calendarView = "week";
let calendarCursor = dateOnly(new Date());
let selectedCalendarDate = dateOnly(new Date());
let cloudClient = null;
let cloudUser = null;
let cloudReady = false;
let cloudUpdatedAt = null;
let cloudBaseState = null;
let cloudProcessingUserId = null;
let cloudSyncTimer = null;
let cloudSyncQueue = Promise.resolve();
let cloudSaving = false;
let cloudRefreshing = false;
let cloudLocalRevision = 0;
let signedOutMessage = "Inicia sesión con GitHub para acceder a tu planificador.";

function loadTasks() {
  try {
    const saved = JSON.parse(localStorage.getItem(storageKey) || "[]");
    return normalizeTasks(saved);
  } catch {
    return [];
  }
}

function normalizeTasks(saved) {
  if (!Array.isArray(saved)) return [];
  return saved.filter((task) => (
    task
    && typeof task.id === "string"
    && typeof task.text === "string"
    && typeof task.completed === "boolean"
  ));
}

function normalizeMeetings(saved) {
  if (!Array.isArray(saved)) return [];
  return saved.filter((meeting) => (
    meeting
    && typeof meeting.id === "string"
    && typeof meeting.title === "string"
    && typeof meeting.start === "string"
    && Number.isFinite(Date.parse(meeting.start))
    && typeof meeting.end === "string"
    && Number.isFinite(Date.parse(meeting.end))
    && typeof meeting.allDay === "boolean"
    && typeof meeting.location === "string"
  ));
}

function saveTasks() {
  try {
    localStorage.setItem(storageKey, JSON.stringify(tasks));
  } catch {
    announcements.textContent = "No se han podido guardar los cambios en este dispositivo.";
  }
  queueCloudSync();
}

function loadMeetingCalendar() {
  try {
    const saved = JSON.parse(localStorage.getItem(meetingStorageKey) || "null");
    if (!saved || !Array.isArray(saved.meetings)) return null;

    return { meetings: normalizeMeetings(saved.meetings) };
  } catch {
    return null;
  }
}

function saveMeetingCalendar() {
  try {
    if (meetingCalendar) {
      localStorage.setItem(meetingStorageKey, JSON.stringify(meetingCalendar));
    } else {
      localStorage.removeItem(meetingStorageKey);
    }
    queueCloudSync();
    return true;
  } catch {
    calendarStatus.textContent = "No se han podido guardar las reuniones en este navegador.";
    calendarStatus.hidden = false;
    announcements.textContent = "No se han podido guardar las reuniones en este navegador.";
    return false;
  }
}

function createIcon(path, viewBox = "0 0 20 20") {
  const svg = document.createElementNS("http://www.w3.org/2000/svg", "svg");
  svg.setAttribute("viewBox", viewBox);
  svg.setAttribute("aria-hidden", "true");

  const shape = document.createElementNS("http://www.w3.org/2000/svg", "path");
  shape.setAttribute("d", path);
  svg.append(shape);
  return svg;
}

function render() {
  const pending = tasks.filter((task) => !task.completed).length;
  const completed = tasks.length - pending;

  count.textContent = `${pending} ${pending === 1 ? "tarea pendiente" : "tareas pendientes"}`;
  emptyState.hidden = tasks.length > 0;
  clearCompletedButton.hidden = completed === 0;
  list.replaceChildren();

  for (const task of tasks) {
    const row = document.createElement("li");
    row.className = `task-item${task.completed ? " is-complete" : ""}`;

    const check = document.createElement("button");
    check.className = "task-check";
    check.type = "button";
    check.setAttribute("aria-pressed", String(task.completed));
    check.setAttribute("aria-label", task.completed ? `Marcar «${task.text}» como pendiente` : `Completar «${task.text}»`);
    if (task.completed) check.append(createIcon("m5 10 3 3 7-7", "0 0 16 16"));
    check.addEventListener("click", () => toggleTask(task.id));

    const text = document.createElement("span");
    text.className = "task-text";
    text.textContent = task.text;

    const remove = document.createElement("button");
    remove.className = "delete-button";
    remove.type = "button";
    remove.setAttribute("aria-label", `Borrar «${task.text}»`);
    remove.title = "Borrar tarea";
    remove.append(createIcon("M4 6h12M8 6V4h4v2m3 0-.7 10H5.7L5 6m3 3v4m4-4v4"));
    remove.addEventListener("click", () => deleteTask(task.id));

    row.append(check, text, remove);
    list.append(row);
  }

  renderMeetings();
}

function formatMeetingTime(meeting) {
  const start = new Date(meeting.start);
  const end = new Date(meeting.end);
  const dateLabel = new Intl.DateTimeFormat("es-ES", {
    weekday: "short",
    day: "numeric",
    month: "short",
  }).format(start);

  if (meeting.allDay) return `${dateLabel} · todo el día`;

  const timeOptions = { hour: "2-digit", minute: "2-digit" };
  const startTime = new Intl.DateTimeFormat("es-ES", timeOptions).format(start);
  const endTime = new Intl.DateTimeFormat("es-ES", timeOptions).format(end);
  if (start.toDateString() === end.toDateString()) return `${dateLabel} · ${startTime}–${endTime}`;

  const endLabel = new Intl.DateTimeFormat("es-ES", {
    weekday: "short",
    day: "numeric",
    month: "short",
    hour: "2-digit",
    minute: "2-digit",
  }).format(end);
  return `${dateLabel}, ${startTime} – ${endLabel}`;
}

function renderMeetings() {
  const meetings = meetingCalendar?.meetings ?? [];
  const hasCalendar = meetingCalendar !== null;

  importCalendarButton.textContent = hasCalendar ? "Cambiar .ics" : "Importar .ics";
  removeCalendarButton.hidden = !hasCalendar;
  meetingCount.textContent = hasCalendar
    ? `${meetings.length} ${meetings.length === 1 ? "reunión próxima" : "reuniones próximas"}`
    : "";
  renderCalendar();
}

function dateOnly(date) {
  return new Date(date.getFullYear(), date.getMonth(), date.getDate());
}

function dateKey(date) {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

function startOfWeek(date) {
  const monday = dateOnly(date);
  monday.setDate(monday.getDate() - ((monday.getDay() + 6) % 7));
  return monday;
}

function getCalendarDates() {
  if (calendarView === "week") {
    const firstDay = startOfWeek(calendarCursor);
    return Array.from({ length: 7 }, (_, index) => {
      const date = new Date(firstDay);
      date.setDate(date.getDate() + index);
      return date;
    });
  }

  const firstOfMonth = new Date(calendarCursor.getFullYear(), calendarCursor.getMonth(), 1);
  const firstCell = startOfWeek(firstOfMonth);
  const dayCount = new Date(calendarCursor.getFullYear(), calendarCursor.getMonth() + 1, 0).getDate();
  const cellCount = Math.ceil(((firstOfMonth.getDay() + 6) % 7 + dayCount) / 7) * 7;
  return Array.from({ length: cellCount }, (_, index) => {
    const date = new Date(firstCell);
    date.setDate(date.getDate() + index);
    return date;
  });
}

function formatCalendarPeriod(days) {
  if (calendarView === "month") {
    const label = new Intl.DateTimeFormat("es-ES", { month: "long", year: "numeric" }).format(calendarCursor);
    return label[0].toLocaleUpperCase("es-ES") + label.slice(1);
  }

  const [start, end] = [days[0], days[days.length - 1]];
  const month = new Intl.DateTimeFormat("es-ES", { month: "short" });
  if (start.getFullYear() === end.getFullYear() && start.getMonth() === end.getMonth()) {
    return `${start.getDate()}–${end.getDate()} ${month.format(end)} ${end.getFullYear()}`;
  }
  return `${start.getDate()} ${month.format(start)} – ${end.getDate()} ${month.format(end)} ${end.getFullYear()}`;
}

function meetingsByDate() {
  const grouped = new Map();
  for (const meeting of meetingCalendar?.meetings ?? []) {
    const start = dateOnly(new Date(meeting.start));
    const end = dateOnly(new Date(meeting.end));
    const dates = [start];

    if (meeting.allDay) {
      const cursor = new Date(start);
      let days = 0;
      while (cursor < end && days < 366) {
        dates.push(new Date(cursor));
        cursor.setDate(cursor.getDate() + 1);
        days += 1;
      }
    }

    for (const date of dates) {
      const key = dateKey(date);
      const dayMeetings = grouped.get(key) ?? [];
      if (!dayMeetings.some((item) => item.id === meeting.id)) dayMeetings.push(meeting);
      grouped.set(key, dayMeetings);
    }
  }
  return grouped;
}

function formatDayLabel(date, options = { weekday: "long", day: "numeric", month: "long", year: "numeric" }) {
  return new Intl.DateTimeFormat("es-ES", options).format(date);
}

function renderCalendar() {
  const days = getCalendarDates();
  const groupedMeetings = meetingsByDate();
  const currentMonth = calendarCursor.getMonth();
  const todayKey = dateKey(dateOnly(new Date()));
  const selectedKey = dateKey(selectedCalendarDate);
  const weekdayNames = ["lun", "mar", "mié", "jue", "vie", "sáb", "dom"];

  calendarPeriod.textContent = formatCalendarPeriod(days);
  selectedDateLabel.textContent = formatDayLabel(selectedCalendarDate);
  calendarGrid.className = `calendar-grid is-${calendarView}`;
  calendarGrid.setAttribute("aria-label", `Calendario ${calendarView === "week" ? "semanal" : "mensual"}: ${calendarPeriod.textContent}`);
  calendarGrid.replaceChildren();
  for (const weekday of weekdayNames) {
    const label = document.createElement("span");
    label.className = "calendar-weekday";
    label.textContent = weekday;
    calendarGrid.append(label);
  }

  for (const date of days) {
    const key = dateKey(date);
    const dayMeetings = groupedMeetings.get(key) ?? [];
    const cell = document.createElement("button");
    cell.className = "calendar-day";
    cell.type = "button";
    if (calendarView === "month" && date.getMonth() !== currentMonth) cell.classList.add("is-outside-month");
    if (key === todayKey) cell.classList.add("is-today");
    if (key === selectedKey) cell.classList.add("is-selected");
    cell.setAttribute("aria-pressed", String(key === selectedKey));
    cell.setAttribute("aria-label", `${formatDayLabel(date)}${dayMeetings.length ? `, ${dayMeetings.length} ${dayMeetings.length === 1 ? "reunión" : "reuniones"}` : ""}`);

    const number = document.createElement("span");
    number.className = "calendar-day-number";
    number.textContent = String(date.getDate());
    cell.append(number);

    const maxVisible = calendarView === "week" ? 3 : 2;
    for (const meeting of dayMeetings.slice(0, maxVisible)) {
      const eventLabel = document.createElement("span");
      eventLabel.className = "calendar-event";
      const start = new Date(meeting.start);
      const time = meeting.allDay ? "" : `${new Intl.DateTimeFormat("es-ES", { hour: "2-digit", minute: "2-digit" }).format(start)} `;
      eventLabel.textContent = `${time}${meeting.title}`;
      eventLabel.title = meeting.title;
      cell.append(eventLabel);
    }
    if (dayMeetings.length > maxVisible) {
      const more = document.createElement("span");
      more.className = "calendar-more";
      more.textContent = `+${dayMeetings.length - maxVisible} más`;
      cell.append(more);
    }

    cell.addEventListener("click", () => {
      selectedCalendarDate = dateOnly(date);
      calendarCursor = dateOnly(date);
      renderCalendar();
    });
    calendarGrid.append(cell);
  }

  const selectedMeetings = groupedMeetings.get(selectedKey) ?? [];
  meetingList.replaceChildren();
  for (const meeting of selectedMeetings) {
    const row = document.createElement("li");
    row.className = "meeting-item";

    const title = document.createElement("span");
    title.className = "meeting-name";
    title.textContent = meeting.title;

    const time = document.createElement("time");
    time.className = "meeting-time";
    time.dateTime = meeting.start;
    time.textContent = formatMeetingTime(meeting);
    row.append(title, time);

    if (meeting.location) {
      const location = document.createElement("span");
      location.className = "meeting-location";
      location.textContent = meeting.location;
      row.append(location);
    }
    meetingList.append(row);
  }

  meetingEmpty.hidden = selectedMeetings.length > 0 || !meetingCalendar;
  if (!meetingCalendar) {
    meetingEmpty.textContent = "";
  } else if (meetingCalendar.meetings.length === 0) {
    meetingEmpty.textContent = "El archivo importado no contiene reuniones futuras.";
  } else {
    meetingEmpty.textContent = "No hay reuniones en esta fecha.";
  }
}

function setPlannerView(view) {
  tasksView.hidden = view !== "tasks";
  calendarViewSection.hidden = view === "tasks";
  pageTitle.textContent = view === "tasks" ? "Tareas" : view === "week" ? "Semana" : "Mes";
  document.title = `${pageTitle.textContent} — Planificador`;

  for (const button of plannerViewButtons) {
    button.setAttribute("aria-pressed", String(button.dataset.plannerView === view));
  }

  if (view !== "tasks") {
    calendarView = view;
    renderCalendar();
  }
}

function moveCalendar(step) {
  if (calendarView === "week") {
    calendarCursor.setDate(calendarCursor.getDate() + step * 7);
  } else {
    calendarCursor = new Date(calendarCursor.getFullYear(), calendarCursor.getMonth() + step, 1);
  }
  selectedCalendarDate = dateOnly(calendarCursor);
  renderCalendar();
}

previousCalendarButton.addEventListener("click", () => moveCalendar(-1));
nextCalendarButton.addEventListener("click", () => moveCalendar(1));
todayCalendarButton.addEventListener("click", () => {
  calendarCursor = dateOnly(new Date());
  selectedCalendarDate = dateOnly(calendarCursor);
  renderCalendar();
});

for (const button of plannerViewButtons) {
  button.addEventListener("click", () => {
    setPlannerView(button.dataset.plannerView);
  });
}

optionsMenu.addEventListener("click", (event) => {
  if (event.target.closest(".options-action")) optionsMenu.open = false;
});

function setCloudStatus(message, state = "info") {
  cloudStatus.textContent = message;
  cloudStatus.dataset.state = state;
}

function writeLocalSnapshot() {
  try {
    localStorage.setItem(storageKey, JSON.stringify(tasks));
    if (meetingCalendar) {
      localStorage.setItem(meetingStorageKey, JSON.stringify(meetingCalendar));
    } else {
      localStorage.removeItem(meetingStorageKey);
    }
    return true;
  } catch {
    setCloudStatus("Conectado. El navegador no pudo guardar una copia local.", "warning");
    return false;
  }
}

function normalizeCloudCalendar(calendar) {
  if (!calendar || calendar.imported !== true) return null;
  return { meetings: normalizeMeetings(calendar.meetings) };
}

function emptyCloudState() {
  return {
    tasks: [],
    meeting_calendar: { imported: false, meetings: [] },
  };
}

function cloneCloudState(state) {
  const calendar = state?.meeting_calendar;
  return {
    tasks: normalizeTasks(state?.tasks).map((task) => ({ ...task })),
    meeting_calendar: calendar?.imported === true
      ? { imported: true, meetings: normalizeMeetings(calendar.meetings).map((meeting) => ({ ...meeting })) }
      : { imported: false, meetings: [] },
  };
}

function cloudStateFromRecord(record) {
  return cloneCloudState({
    tasks: record?.tasks,
    meeting_calendar: record?.meeting_calendar,
  });
}

function loadCloudBase(userId) {
  try {
    const saved = JSON.parse(localStorage.getItem(`${cloudBaseStoragePrefix}${userId}`) || "null");
    return saved ? cloneCloudState(saved) : null;
  } catch {
    return null;
  }
}

function saveCloudBase(userId, state) {
  try {
    localStorage.setItem(
      `${cloudBaseStoragePrefix}${userId}`,
      JSON.stringify(cloneCloudState(state)),
    );
  } catch {
    // Cloud state remains authoritative if the local sync base cannot be cached.
  }
}

function currentCloudState() {
  return cloneCloudState({
    tasks,
    meeting_calendar: meetingCalendar
      ? { imported: true, meetings: meetingCalendar.meetings }
      : { imported: false, meetings: [] },
  });
}

function applyCloudState(state) {
  const normalized = cloneCloudState(state);
  tasks = normalized.tasks;
  meetingCalendar = normalized.meeting_calendar.imported
    ? { meetings: normalized.meeting_calendar.meetings }
    : null;
}

function canonicalCloudValue(value) {
  if (Array.isArray(value)) return value.map(canonicalCloudValue);
  if (value && typeof value === "object") {
    return Object.fromEntries(
      Object.entries(value)
        .sort(([left], [right]) => left.localeCompare(right))
        .map(([key, item]) => [key, canonicalCloudValue(item)]),
    );
  }
  return value;
}

function sameCloudValue(left, right) {
  return JSON.stringify(canonicalCloudValue(left)) === JSON.stringify(canonicalCloudValue(right));
}

function mergeCloudItems(baseItems, localItems, remoteItems) {
  const base = new Map(baseItems.map((item) => [item.id, item]));
  const local = new Map(localItems.map((item) => [item.id, item]));
  const remote = new Map(remoteItems.map((item) => [item.id, item]));
  const ids = new Set([...base.keys(), ...local.keys(), ...remote.keys()]);
  const merged = [];
  let conflicts = 0;

  for (const id of ids) {
    const baseItem = base.get(id);
    const localItem = local.get(id);
    const remoteItem = remote.get(id);
    const localChanged = !sameCloudValue(localItem, baseItem);
    const remoteChanged = !sameCloudValue(remoteItem, baseItem);
    let item;

    if (localChanged && remoteChanged && !sameCloudValue(localItem, remoteItem)) {
      conflicts += 1;
      if (!localItem) {
        item = remoteItem;
      } else if (!remoteItem) {
        item = localItem;
      } else {
        item = {};
        const fields = new Set([
          ...Object.keys(baseItem ?? {}),
          ...Object.keys(localItem),
          ...Object.keys(remoteItem),
        ]);
        for (const field of fields) {
          const baseValue = baseItem?.[field];
          const localValue = localItem[field];
          const remoteValue = remoteItem[field];
          const localFieldChanged = !sameCloudValue(localValue, baseValue);
          const remoteFieldChanged = !sameCloudValue(remoteValue, baseValue);
          const value = localFieldChanged ? localValue : remoteValue;
          if (value !== undefined) item[field] = value;
          if (localFieldChanged && remoteFieldChanged && !sameCloudValue(localValue, remoteValue)) {
            conflicts += 1;
          }
        }
      }
    } else {
      item = localChanged ? localItem : remoteItem;
    }

    if (item) merged.push(item);
  }

  return { items: merged, conflicts };
}

function mergeCloudStates(baseState, localState, remoteState) {
  const base = cloneCloudState(baseState ?? emptyCloudState());
  const local = cloneCloudState(localState);
  const remote = cloneCloudState(remoteState);
  const tasksResult = mergeCloudItems(base.tasks, local.tasks, remote.tasks);
  const meetingsResult = mergeCloudItems(
    base.meeting_calendar.meetings,
    local.meeting_calendar.meetings,
    remote.meeting_calendar.meetings,
  );
  const localImportedChanged = !sameCloudValue(
    local.meeting_calendar.imported,
    base.meeting_calendar.imported,
  );
  const remoteImportedChanged = !sameCloudValue(
    remote.meeting_calendar.imported,
    base.meeting_calendar.imported,
  );
  const imported = localImportedChanged
    ? local.meeting_calendar.imported
    : remote.meeting_calendar.imported;

  return {
    state: {
      tasks: tasksResult.items,
      meeting_calendar: {
        imported,
        meetings: imported ? meetingsResult.items : [],
      },
    },
    conflicts: tasksResult.conflicts + meetingsResult.conflicts
      + Number(
        localImportedChanged
        && remoteImportedChanged
        && !sameCloudValue(local.meeting_calendar.imported, remote.meeting_calendar.imported),
      ),
  };
}

function scheduleCloudSync() {
  if (!cloudReady || !cloudUser) return;
  window.clearTimeout(cloudSyncTimer);
  cloudSyncTimer = window.setTimeout(() => {
    cloudSyncTimer = null;
    cloudSyncQueue = cloudSyncQueue
      .then(() => persistCloudState())
      .catch((error) => {
        setCloudStatus(
          `No se pudieron sincronizar los cambios. Siguen guardados en este navegador. ${error.message || ""}`.trim(),
          "error",
        );
        announcements.textContent = "No se pudieron sincronizar los cambios con la nube.";
      });
  }, 450);
}

function queueCloudSync() {
  if (!cloudReady || !cloudUser) return;
  cloudLocalRevision += 1;
  scheduleCloudSync();
}

async function reconcileCloudConflict() {
  const { data: saved, error } = await cloudClient
    .from("planner_state")
    .select("tasks, meeting_calendar, updated_at")
    .eq("user_id", cloudUser.id)
    .maybeSingle();
  if (error) throw error;

  const remoteState = saved ? cloudStateFromRecord(saved) : emptyCloudState();
  const { state, conflicts } = mergeCloudStates(
    cloudBaseState,
    currentCloudState(),
    remoteState,
  );

  cloudBaseState = cloneCloudState(remoteState);
  saveCloudBase(cloudUser.id, cloudBaseState);
  cloudUpdatedAt = saved?.updated_at ?? null;
  applyCloudState(state);
  writeLocalSnapshot();
  render();
  setCloudStatus(
    conflicts > 0
      ? "Se combinaron cambios de otro dispositivo. Revisa los elementos editados a la vez; guardando…"
      : "Se combinaron cambios de otro dispositivo. Guardando…",
    "busy",
  );
  scheduleCloudSync();
}

async function persistCloudState() {
  if (!cloudReady || !cloudUser) return false;

  const sentRevision = cloudLocalRevision;
  const sentState = currentCloudState();
  cloudSaving = true;
  setCloudStatus("Sincronizando cambios…", "busy");
  try {
    const { data, error } = await cloudClient.rpc("save_planner_state", {
      p_tasks: sentState.tasks,
      p_meeting_calendar: sentState.meeting_calendar,
      p_expected_updated_at: cloudUpdatedAt,
    });

    if (error) throw error;
    if (!data) {
      await reconcileCloudConflict();
      return false;
    }

    cloudUpdatedAt = data;
    cloudBaseState = cloneCloudState(sentState);
    saveCloudBase(cloudUser.id, cloudBaseState);
    if (sentRevision !== cloudLocalRevision) {
      setCloudStatus("Guardando los últimos cambios…", "busy");
      scheduleCloudSync();
      return true;
    }

    setCloudStatus("Sincronizado con la nube", "success");
    return true;
  } finally {
    cloudSaving = false;
  }
}

async function activateCloudSession(session) {
  const user = session?.user;
  if (!user?.id || !cloudClient) return;
  if ((cloudReady && cloudUser?.id === user.id) || cloudProcessingUserId === user.id) return;

  cloudProcessingUserId = user.id;
  let mergedConflicts = 0;
  let cloudNeedsMergeSave = false;
  try {
    cloudUser = user;
    githubLoginButton.hidden = true;
    githubLogoutButton.hidden = false;
    plannerOptions.hidden = true;
    setCloudStatus("Cargando datos de la nube…", "busy");

    const { data: saved, error: loadError } = await cloudClient
      .from("planner_state")
      .select("tasks, meeting_calendar, updated_at")
      .eq("user_id", user.id)
      .maybeSingle();
    if (loadError) throw loadError;

    if (saved) {
      const localState = currentCloudState();
      const previousBase = loadCloudBase(user.id) ?? emptyCloudState();
      const remoteState = cloudStateFromRecord(saved);
      const merged = mergeCloudStates(previousBase, localState, remoteState);
      cloudBaseState = cloneCloudState(remoteState);
      applyCloudState(merged.state);
      mergedConflicts = merged.conflicts;
      cloudNeedsMergeSave = !sameCloudValue(merged.state, remoteState);
      saveCloudBase(user.id, cloudBaseState);
      cloudUpdatedAt = saved.updated_at;
      writeLocalSnapshot();
    } else {
      cloudBaseState = emptyCloudState();
      cloudUpdatedAt = null;
    }

    cloudReady = true;
    plannerOptions.hidden = false;
    plannerContent.hidden = false;
    render();

    if (!saved) {
      await persistCloudState();
    } else if (cloudNeedsMergeSave) {
      setCloudStatus(
        mergedConflicts > 0
          ? "Combinando tus datos de este navegador con la nube…"
          : "Guardando datos de este navegador en la nube…",
        "busy",
      );
      queueCloudSync();
    } else {
      setCloudStatus("Sincronizado con la nube", "success");
    }
  } catch (error) {
    cloudReady = false;
    cloudUser = null;
    cloudUpdatedAt = null;
    cloudBaseState = null;
    plannerOptions.hidden = true;
    plannerContent.hidden = true;
    githubLoginButton.hidden = true;
    githubLogoutButton.hidden = false;
    setCloudStatus(
      error?.code === "42501"
        ? "Esta cuenta de GitHub no tiene acceso al planificador."
        : `No se pudo cargar el planificador en la nube. ${error.message || ""}`.trim(),
      "error",
    );
  } finally {
    cloudProcessingUserId = null;
  }
}

async function initializeCloud() {
  const configured = typeof cloudConfig.supabaseUrl === "string"
    && cloudConfig.supabaseUrl.startsWith("https://")
    && typeof cloudConfig.supabasePublishableKey === "string"
    && cloudConfig.supabasePublishableKey.length > 10;

  plannerContent.hidden = true;
  plannerOptions.hidden = true;
  if (!configured) {
    githubLoginButton.hidden = false;
    githubLoginButton.disabled = true;
    setCloudStatus("Falta configurar el proyecto de almacenamiento en la nube.", "warning");
    return;
  }

  if (!globalThis.supabase?.createClient) {
    githubLoginButton.hidden = false;
    githubLoginButton.disabled = true;
    setCloudStatus("No se pudo cargar el cliente de almacenamiento.", "error");
    return;
  }

  cloudClient = globalThis.supabase.createClient(
    cloudConfig.supabaseUrl,
    cloudConfig.supabasePublishableKey,
    { auth: { persistSession: true, autoRefreshToken: true, detectSessionInUrl: true } },
  );

  githubLoginButton.hidden = false;
  githubLoginButton.disabled = false;
  setCloudStatus("Inicia sesión con GitHub para acceder a tu planificador.");

  cloudClient.auth.onAuthStateChange((event, session) => {
    if (event === "SIGNED_OUT") {
      cloudReady = false;
      cloudUser = null;
      cloudUpdatedAt = null;
      cloudBaseState = null;
      window.clearTimeout(cloudSyncTimer);
      plannerOptions.hidden = true;
      plannerContent.hidden = true;
      githubLoginButton.hidden = false;
      githubLoginButton.disabled = false;
      githubLogoutButton.hidden = true;
      setCloudStatus(signedOutMessage, "info");
      return;
    }

    if (session && ["INITIAL_SESSION", "SIGNED_IN"].includes(event)) {
      window.setTimeout(() => activateCloudSession(session), 0);
    }
  });

  const { data: sessionData, error } = await cloudClient.auth.getSession();
  if (error) {
    setCloudStatus("No se pudo recuperar la sesión de GitHub.", "error");
    return;
  }
  if (sessionData.session) {
    await activateCloudSession(sessionData.session);
  }
}

async function refreshCloudState() {
  if (!cloudReady || !cloudUser || cloudSaving || cloudSyncTimer || cloudRefreshing) return;

  const localRevision = cloudLocalRevision;
  cloudRefreshing = true;
  try {
    const { data, error } = await cloudClient
      .from("planner_state")
      .select("tasks, meeting_calendar, updated_at")
      .eq("user_id", cloudUser.id)
      .maybeSingle();
    if (error) throw error;
    if (!data || Date.parse(data.updated_at) <= Date.parse(cloudUpdatedAt || "1970-01-01")) return;

    if (localRevision !== cloudLocalRevision || cloudSaving || cloudSyncTimer) {
      if (!cloudSyncTimer) scheduleCloudSync();
      return;
    }

    cloudBaseState = cloudStateFromRecord(data);
    applyCloudState(cloudBaseState);
    saveCloudBase(cloudUser.id, cloudBaseState);
    cloudUpdatedAt = data.updated_at;
    writeLocalSnapshot();
    render();
    setCloudStatus("Sincronizado con la nube", "success");
  } catch {
    setCloudStatus("No se pudo comprobar la nube; los datos locales siguen disponibles.", "warning");
  } finally {
    cloudRefreshing = false;
  }
}

githubLoginButton.addEventListener("click", async () => {
  if (!cloudClient) return;
  githubLoginButton.disabled = true;
  setCloudStatus("Conectando con GitHub…", "busy");

  const redirectTo = `${window.location.origin}${window.location.pathname}`;
  const { error } = await cloudClient.auth.signInWithOAuth({
    provider: "github",
    options: { redirectTo },
  });

  if (error) {
    githubLoginButton.disabled = false;
    setCloudStatus(`No se pudo iniciar sesión con GitHub. ${error.message}`, "error");
  }
});

githubLogoutButton.addEventListener("click", async () => {
  if (!cloudClient) return;
  signedOutMessage = "Sesión cerrada.";
  const { error } = await cloudClient.auth.signOut();
  if (error) setCloudStatus(`No se pudo cerrar la sesión. ${error.message}`, "error");
});

window.addEventListener("focus", refreshCloudState);
document.addEventListener("visibilitychange", () => {
  if (document.visibilityState === "visible") refreshCloudState();
});

function addTask(text) {
  const task = {
    id: globalThis.crypto?.randomUUID?.() ?? `${Date.now()}-${Math.random().toString(16).slice(2)}`,
    text,
    completed: false,
  };

  tasks.push(task);
  saveTasks();
  render();
  announcements.textContent = "Tarea añadida.";
}

function toggleTask(id) {
  tasks = tasks.map((task) => task.id === id ? { ...task, completed: !task.completed } : task);
  saveTasks();
  render();
}

function deleteTask(id) {
  tasks = tasks.filter((task) => task.id !== id);
  saveTasks();
  render();
  announcements.textContent = "Tarea borrada.";
}

form.addEventListener("submit", (event) => {
  event.preventDefault();
  const text = input.value.trim();
  if (!text) return;

  addTask(text);
  form.reset();
  input.focus();
});

clearCompletedButton.addEventListener("click", () => {
  const removed = tasks.filter((task) => task.completed).length;
  tasks = tasks.filter((task) => !task.completed);
  saveTasks();
  render();
  announcements.textContent = `${removed} ${removed === 1 ? "tarea completada borrada" : "tareas completadas borradas"}.`;
});

resetAllButton.addEventListener("click", () => {
  const confirmed = window.confirm(
    "¿Restablecer todo? Se borrarán todas las tareas y reuniones de este navegador y de la nube. Esta acción no se puede deshacer.",
  );
  if (!confirmed) return;

  tasks = [];
  meetingCalendar = null;
  calendarStatus.textContent = "";
  calendarStatus.hidden = true;
  const localSaved = writeLocalSnapshot();
  queueCloudSync();
  render();
  setCloudStatus(
    localSaved
      ? "Restableciendo todos los datos…"
      : "No se pudo guardar localmente; se intentará restablecer en la nube.",
    localSaved ? "busy" : "warning",
  );
  announcements.textContent = "Se está restableciendo todo el planificador.";
});

function parseCalendar(icsText) {
  if (!globalThis.ICAL?.parse) {
    throw new Error("No se pudo cargar el lector de archivos .ics.");
  }

  const calendar = new ICAL.Component(ICAL.parse(icsText));
  if (calendar.name !== "vcalendar") {
    throw new Error("El archivo no tiene un calendario iCalendar válido.");
  }

  for (const timezone of calendar.getAllSubcomponents("vtimezone")) {
    ICAL.TimezoneService.register(timezone);
  }

  const components = calendar.getAllSubcomponents("vevent");
  if (components.length === 0) {
    throw new Error("El archivo no contiene reuniones.");
  }
  if (components.length > 5000) {
    throw new Error("El calendario es demasiado grande. Exporta un periodo más corto desde Outlook.");
  }

  const exceptionsByUid = new Map();
  for (const component of components) {
    if (!component.hasProperty("recurrence-id")) continue;
    const uid = component.getFirstPropertyValue("uid") ?? "";
    const exceptions = exceptionsByUid.get(uid) ?? [];
    exceptions.push(component);
    exceptionsByUid.set(uid, exceptions);
  }

  const now = new Date();
  const horizon = new Date(now);
  horizon.setFullYear(horizon.getFullYear() + 1);
  const meetings = [];
  let inspected = 0;

  for (const component of components) {
    if (component.hasProperty("recurrence-id")) continue;

    const uid = component.getFirstPropertyValue("uid") ?? "";
    const event = new ICAL.Event(component, {
      exceptions: exceptionsByUid.get(uid) ?? [],
    });
    if (!event.startDate) continue;

    const iterator = event.iterator();
    let occurrence;
    let eventOccurrences = 0;
    while ((occurrence = iterator.next())) {
      eventOccurrences += 1;
      inspected += 1;
      if (eventOccurrences > 10000 || inspected > 50000) {
        throw new Error("El calendario tiene demasiadas repeticiones. Exporta un periodo más corto desde Outlook.");
      }

      const details = event.getOccurrenceDetails(occurrence);
      const item = details.item ?? event;
      const status = item.component.getFirstPropertyValue("status");
      if (String(status ?? "").toUpperCase() === "CANCELLED") continue;

      const start = details.startDate?.toJSDate();
      const end = details.endDate?.toJSDate();
      if (!start || !end || !Number.isFinite(start.getTime()) || !Number.isFinite(end.getTime())) continue;
      if (start > horizon) break;
      if (end <= now) continue;

      meetings.push({
        id: `${uid || item.summary || "reunion"}-${start.toISOString()}`,
        title: item.summary || "Reunión",
        start: start.toISOString(),
        end: end.toISOString(),
        allDay: details.startDate.isDate,
        location: item.location || "",
      });
      if (meetings.length > 5000) {
        throw new Error("El calendario contiene demasiadas reuniones. Exporta un periodo más corto desde Outlook.");
      }
    }
  }

  return meetings.sort((a, b) => Date.parse(a.start) - Date.parse(b.start));
}

importCalendarButton.addEventListener("click", () => calendarInput.click());

calendarInput.addEventListener("change", async () => {
  const [file] = calendarInput.files ?? [];
  if (!file) return;

  try {
    if (file.size > 8 * 1024 * 1024) {
      throw new Error("El archivo supera 8 MB. Exporta un periodo más corto desde Outlook.");
    }

    const meetings = parseCalendar(await file.text());
    const previousCalendar = meetingCalendar;
    meetingCalendar = { meetings };
    if (meetings.length > 0) {
      calendarCursor = dateOnly(new Date(meetings[0].start));
      selectedCalendarDate = dateOnly(calendarCursor);
    }
    if (saveMeetingCalendar()) {
      calendarStatus.hidden = true;
      calendarStatus.textContent = "";
      renderMeetings();
      announcements.textContent = `${meetings.length} ${meetings.length === 1 ? "reunión próxima importada" : "reuniones próximas importadas"}.`;
    } else {
      meetingCalendar = previousCalendar;
    }
  } catch (error) {
    const message = `No se pudo importar el calendario: ${error.message || "revisa el archivo .ics"}`;
    calendarStatus.textContent = message;
    calendarStatus.hidden = false;
    announcements.textContent = message;
  } finally {
    calendarInput.value = "";
  }
});

removeCalendarButton.addEventListener("click", () => {
  const previousCalendar = meetingCalendar;
  meetingCalendar = null;
  if (saveMeetingCalendar()) {
    calendarStatus.hidden = true;
    calendarStatus.textContent = "";
    renderMeetings();
    announcements.textContent = "Calendario de reuniones quitado.";
  } else {
    meetingCalendar = previousCalendar;
  }
});

render();
initializeCloud();
