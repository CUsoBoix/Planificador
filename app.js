const storageKey = "planificador-tareas-v1";
const meetingStorageKey = "planificador-reuniones-v1";

const form = document.querySelector("#task-form");
const input = document.querySelector("#task-input");
const list = document.querySelector("#task-list");
const count = document.querySelector("#task-count");
const emptyState = document.querySelector("#empty-state");
const footer = document.querySelector("#page-footer");
const clearCompletedButton = document.querySelector("#clear-completed");
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
const calendarViewButtons = document.querySelectorAll("[data-calendar-view]");
const announcements = document.querySelector("#announcements");

let tasks = loadTasks();
let meetingCalendar = loadMeetingCalendar();
let calendarView = "week";
let calendarCursor = dateOnly(new Date());
let selectedCalendarDate = dateOnly(new Date());

function loadTasks() {
  try {
    const saved = JSON.parse(localStorage.getItem(storageKey) || "[]");
    if (!Array.isArray(saved)) return [];

    return saved.filter((task) => (
      task
      && typeof task.id === "string"
      && typeof task.text === "string"
      && typeof task.completed === "boolean"
    ));
  } catch {
    return [];
  }
}

function saveTasks() {
  try {
    localStorage.setItem(storageKey, JSON.stringify(tasks));
  } catch {
    announcements.textContent = "No se han podido guardar los cambios en este dispositivo.";
  }
}

function loadMeetingCalendar() {
  try {
    const saved = JSON.parse(localStorage.getItem(meetingStorageKey) || "null");
    if (!saved || !Array.isArray(saved.meetings)) return null;

    return {
      meetings: saved.meetings.filter((meeting) => (
        meeting
        && typeof meeting.id === "string"
        && typeof meeting.title === "string"
        && typeof meeting.start === "string"
        && Number.isFinite(Date.parse(meeting.start))
        && typeof meeting.end === "string"
        && Number.isFinite(Date.parse(meeting.end))
        && typeof meeting.allDay === "boolean"
        && typeof meeting.location === "string"
      )),
    };
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
  footer.hidden = completed === 0;
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

  meetingEmpty.hidden = selectedMeetings.length > 0;
  if (!meetingCalendar) {
    meetingEmpty.textContent = "Exporta tu calendario de Outlook como .ics y cárgalo aquí. Las reuniones importadas se guardan solo en este navegador.";
  } else if (meetingCalendar.meetings.length === 0) {
    meetingEmpty.textContent = "El archivo importado no contiene reuniones futuras.";
  } else {
    meetingEmpty.textContent = "No hay reuniones en esta fecha.";
  }

  for (const button of calendarViewButtons) {
    button.setAttribute("aria-pressed", String(button.dataset.calendarView === calendarView));
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

for (const button of calendarViewButtons) {
  button.addEventListener("click", () => {
    calendarView = button.dataset.calendarView;
    renderCalendar();
  });
}

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
