const storageKey = "planificador-tareas-v1";

const form = document.querySelector("#task-form");
const input = document.querySelector("#task-input");
const list = document.querySelector("#task-list");
const count = document.querySelector("#task-count");
const emptyState = document.querySelector("#empty-state");
const footer = document.querySelector("#page-footer");
const clearCompletedButton = document.querySelector("#clear-completed");
const announcements = document.querySelector("#announcements");

let tasks = loadTasks();

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

render();
