const { test } = require("node:test"),
  assert = require("node:assert/strict"),
  { JSDOM } = require("jsdom"),
  fs = require("node:fs"),
  path = require("node:path"),
  vm = require("node:vm");
function app() {
  const dir = path.join(__dirname, "..");
  const dom = new JSDOM(fs.readFileSync(path.join(dir, "index.html"), "utf8"), {
    url: "https://planner.test/",
    runScripts: "outside-only",
    pretendToBeVisual: true,
  });
  const w = dom.window,
    run = (code) => vm.runInContext(code, dom.getInternalVMContext());
  w.HTMLDialogElement.prototype.showModal = function () {
    this.open = true;
  };
  w.HTMLDialogElement.prototype.close = function () {
    this.open = false;
  };
  w.confirm = () => true;
  w.structuredClone = structuredClone;
  for (const f of [
    "assets/vendor/ical.min.js",
    "assets/vendor/marked.min.js",
    "assets/vendor/purify.min.js",
    "work-engine.js",
    "file-rules.js",
    "app.js",
    "work-ui.js",
  ])
    run(fs.readFileSync(path.join(dir, f), "utf8"));
  run(
    `cloudReady=true;cloudUser={id:'test'};queueCloudSync=()=>{};plannerContent.hidden=false;`,
  );
  const click = (text) => {
    const scope = w.document.querySelector("#work-dialog").open
      ? w.document.querySelector("#work-dialog")
      : w.document;
    const b = [...scope.querySelectorAll("button")].find(
      (b) => b.textContent.trim() === text,
    );
    assert.ok(b, "Button " + text);
    b.click();
  };
  const input = (label, value) => {
    const l = [...w.document.querySelectorAll("#work-dialog label")].find(
      (l) => l.firstChild.textContent === label,
    );
    assert.ok(l, "Field " + label);
    l.querySelector("input,select,textarea").value = value;
  };
  return { dom, w, run, click, input };
}
test("create edit complete reopen archive recover with documentation comments checklist", () => {
  const { dom, w, run, click, input } = app();
  try {
    click("+ Nueva tarea");
    input("Título", "Informe real");
    input("Duración estimada (min)", "45");
    w.document
      .querySelector("#work-dialog form")
      .dispatchEvent(
        new w.Event("submit", { bubbles: true, cancelable: true }),
      );
    assert.equal(run("tasks.length"), 1);
    assert.equal(run("tasks[0].remaining"), 45);
    w.document.querySelector("#work-dialog").close();
    w.openWorkTask(run("tasks[0].id"));
    input("Descripción", "Detalles");
    click("Guardar resumen");
    assert.equal(run("tasks[0].description"), "Detalles");
    input("Documento", "# Procedimiento\n<script>alert(1)</script>");
    click("Guardar documentación");
    click("Vista previa");
    assert.equal(w.document.querySelector(".document-preview script"), null);
    input("Nuevo punto", "Validar suma");
    click("Añadir punto");
    assert.equal(run("tasks[0].checklist.length"), 1);
    input("Nuevo comentario", "Revisado");
    click("Comentar");
    assert.equal(run("tasks[0].comments.length"), 1);
    click("Completar");
    assert.equal(run("tasks[0].completed"), true);
    click("Reabrir");
    assert.equal(run("tasks[0].completed"), false);
    click("Archivar");
    assert.equal(run("tasks[0].archived"), true);
    assert.equal(run("tasks[0].comments[0].text"), "Revisado");
    click("Recuperar");
    assert.equal(run("tasks[0].archived"), false);
    assert.ok(run("tasks[0].documents").startsWith("# Procedimiento"));
    run("writeLocalSnapshot()");
    assert.equal(
      JSON.parse(w.localStorage.getItem("planificador-tareas-v1")).length,
      1,
    );
  } finally {
    dom.window.close();
  }
});
test("projects, recurrence generation and persisted cloud round trip", () => {
  const { dom, w, run, click, input } = app();
  try {
    click("Proyectos");
    click("+ Nuevo proyecto");
    input("Nombre", "Automatizar reporting");
    click("Guardar proyecto");
    assert.equal(run("workState.projects.length"), 1);
    w.document.querySelector("#work-dialog").close();
    click("Recurrentes");
    click("+ Nueva plantilla");
    input("Nombre", "Cierre");
    click("Guardar plantilla");
    const count = run("tasks.length");
    assert.ok(count > 0);
    click("Guardar plantilla");
    assert.equal(run("tasks.length"), count);
    run(
      `const snapshot=currentCloudState(); workState=WorkEngine.workspace(); tasks=[]; applyCloudState(snapshot);`,
    );
    assert.equal(run("workState.projects[0].text"), "Automatizar reporting");
    assert.equal(run("tasks.length"), count);
  } finally {
    dom.window.close();
  }
});
test("proposals need acceptance, preserve meetings and reject stale inputs", () => {
  const { dom, w, run, click } = app();
  try {
    run(
      `tasks=[WorkEngine.task({id:'t',text:'Concentración',type:'Concentración',estimated:120,remaining:120,completed:false})];`,
    );
    click("Hoy");
    click("Generar planificación");
    assert.equal(run("workState.sessions.length"), 0);
    assert.equal(run("workState.proposals.length"), 2);
    run(`tasks[0].remaining=130`);
    click("Aceptar planificación");
    assert.equal(run("workState.sessions.length"), 0);
    assert.match(
      w.document.querySelector("#work-message").textContent,
      /han cambiado/,
    );
  } finally {
    dom.window.close();
  }
});
test("ICS existing parser: stable IDs, repeated imports, all-day and recurrence", () => {
  const { dom, run } = app();
  try {
    const y = new Date().getFullYear() + 1;
    const ics = `BEGIN:VCALENDAR\r\nVERSION:2.0\r\nPRODID:-//Test//ES\r\nBEGIN:VEVENT\r\nUID:meeting-1\r\nDTSTART:${y}0105T100000Z\r\nDTEND:${y}0105T110000Z\r\nSUMMARY:Reunión\r\nRRULE:FREQ=DAILY;COUNT=2\r\nEND:VEVENT\r\nEND:VCALENDAR`;
    const first = run(`parseCalendar(${JSON.stringify(ics)})`),
      second = run(`parseCalendar(${JSON.stringify(ics)})`);
    assert.equal(first.length, 2);
    assert.equal(JSON.stringify(first), JSON.stringify(second));
    run(
      `meetingCalendar={meetings:parseCalendar(${JSON.stringify(ics)})};const before=JSON.stringify(meetingCalendar);WorkEngine.plan({from:'${y}-01-05',now:'${y}-01-05T06:00Z',tasks:[],meetings:meetingCalendar.meetings});if(before!==JSON.stringify(meetingCalendar))throw Error('mutation');`,
    );
  } finally {
    dom.window.close();
  }
});
test("cloud merge retains independent entities and revisions", () => {
  const { dom, run } = app();
  try {
    assert.equal(
      run(
        `(()=>{const base=emptyCloudState(),a=cloneCloudState(base),b=cloneCloudState(base);a.work_state.projects.push({id:'p',text:'Proyecto'});b.work_state.recurrences.push({id:'r',text:'Recurrencia'});const result=mergeCloudStates(base,a,b).state;return result.work_state.projects.length+result.work_state.recurrences.length;})()`,
      ),
      2,
    );
  } finally {
    dom.window.close();
  }
});
test("snapshots are immutable and concurrent comments are both retained", () => {
  const { dom, run } = app();
  try {
    assert.equal(
      run(
        `(()=>{tasks=[WorkEngine.task({id:'t',text:'Task',comments:[{id:'c1',text:'Initial'}]})];const base=currentCloudState();tasks[0].comments[0].text='Changed';if(base.tasks[0].comments[0].text!=='Initial')return false;const local=cloneCloudState(base),remote=cloneCloudState(base);local.tasks[0].comments.push({id:'c2',text:'Local'});remote.tasks[0].comments.push({id:'c3',text:'Remote'});return mergeCloudStates(base,local,remote).state.tasks[0].comments.length===3;})()`,
      ),
      true,
    );
  } finally {
    dom.window.close();
  }
});
test("ICS all-day event stays marked and parser errors remain explicit", () => {
  const { dom, run } = app();
  try {
    const y = new Date().getFullYear() + 1,
      ics = `BEGIN:VCALENDAR\r\nVERSION:2.0\r\nBEGIN:VEVENT\r\nUID:day\r\nDTSTART;VALUE=DATE:${y}0201\r\nDTEND;VALUE=DATE:${y}0202\r\nSUMMARY:Ausencia\r\nEND:VEVENT\r\nEND:VCALENDAR`;
    assert.equal(run(`parseCalendar(${JSON.stringify(ics)})[0].allDay`), true);
    assert.throws(() =>
      run(
        `parseCalendar('BEGIN:VCALENDAR\\r\\nVERSION:2.0\\r\\nEND:VCALENDAR')`,
      ),
    );
  } finally {
    dom.window.close();
  }
});
test("accepting a future proposal creates stable sessions and preserves the proposal history", () => {
  const { dom, w, run, click, input } = app();
  try {
    run(
      `tasks=[WorkEngine.task({id:'future',text:'Work',remaining:90,estimated:90,type:'Concentración'})];`,
    );
    click("Hoy");
    let day = run(`WorkEngine.dateAt(Date.now())`);
    do {
      day = run(`WorkEngine.dayAdd('${day}',1)`);
    } while (![1, 2, 3, 4, 5].includes(run(`WorkEngine.weekday('${day}')`)));
    const date = w.document.querySelector("#work-view input[type=date]");
    date.value = day;
    date.dispatchEvent(new w.Event("change"));
    click("Generar planificación");
    click("Modificar sesión propuesta");
    input("Duración (min)", "60");
    click("Guardar cambio en propuesta");
    assert.equal(run("workState.sessions.length"), 0);
    assert.equal(run("workState.proposals.at(-1).unscheduled[0].minutes"), 30);
    click("Aceptar planificación");
    assert.ok(run("workState.sessions.length") > 0);
    assert.equal(run("workState.proposals.at(-1).status"), "accepted");
    assert.equal(run("workState.sessions[0].status"), "accepted");
    const before = run("JSON.stringify(workState.sessions)");
    click("Regenerar");
    assert.equal(run("JSON.stringify(workState.sessions)"), before);
  } finally {
    dom.window.close();
  }
});
function exposed(node) {
  for (let p = node; p; p = p.parentElement) {
    if (p.hidden) return false;
    if (
      p.tagName === "DETAILS" &&
      !p.open &&
      !p.querySelector("summary")?.contains(node)
    )
      return false;
  }
  return true;
}
test("quick capture exposes three fields, closes by default and allows consecutive entry", () => {
  const { dom, w, run, click, input } = app();
  try {
    click("+ Nueva tarea");
    const dialog = w.document.querySelector("#work-dialog");
    assert.equal(
      [...dialog.querySelectorAll("input,select")].filter(exposed).length,
      3,
    );
    input("Título", "Una petición");
    dialog
      .querySelector("form")
      .dispatchEvent(
        new w.Event("submit", { bubbles: true, cancelable: true }),
      );
    assert.equal(dialog.open, false);
    assert.equal(run("tasks.length"), 1);
    click("+ Nueva tarea");
    dialog.querySelector("details").open = true;
    const another = [...dialog.querySelectorAll("label")]
      .find((x) => x.firstChild.textContent === "Crear otra después")
      .querySelector("input");
    another.checked = true;
    input("Título", "Segunda petición");
    dialog
      .querySelector("form")
      .dispatchEvent(
        new w.Event("submit", { bubbles: true, cancelable: true }),
      );
    assert.equal(dialog.open, true);
    assert.equal(run("tasks.length"), 2);
  } finally {
    dom.window.close();
  }
});
test("task detail keeps five fields visible and preserves advanced values on save", () => {
  const { dom, w, run, click, input } = app();
  try {
    run(
      `tasks=[WorkEngine.task({id:'t',text:'Revisar cierre',impact:5,boss:true,estimated:90,remaining:60,waitingPerson:'Equipo',tags:['cierre']})];`,
    );
    w.openWorkTask("t");
    const dialog = w.document.querySelector("#work-dialog");
    assert.equal(
      [...dialog.querySelectorAll("input,select,textarea")].filter(exposed)
        .length,
      5,
    );
    input("Título", "Revisar cierre mensual");
    click("Guardar resumen");
    assert.equal(run("tasks[0].text"), "Revisar cierre mensual");
    assert.equal(run("tasks[0].estimated"), 90);
    assert.equal(run("tasks[0].impact"), 5);
    assert.equal(run("tasks[0].waitingPerson"), "Equipo");
    assert.equal(run("tasks[0].boss"), true);
    const advanced = [...dialog.querySelectorAll("details")].find(
      (x) =>
        x.querySelector("summary")?.textContent === "Más detalles y prioridad",
    );
    advanced.open = true;
    click("Guardar resumen");
    assert.equal(
      [...dialog.querySelectorAll("details")].find(
        (x) =>
          x.querySelector("summary")?.textContent ===
          "Más detalles y prioridad",
      ).open,
      true,
    );
  } finally {
    dom.window.close();
  }
});
test("home has a single primary action and calendar switches stay inside the calendar", () => {
  const { dom, w, run, click } = app();
  try {
    run(`tasks=[WorkEngine.task({id:'t',text:'Revisar',remaining:30})];`);
    w.openWorkHome();
    assert.equal(w.document.querySelector("#page-title").textContent, "Hoy");
    assert.equal(
      w.document.querySelectorAll("#work-view .today-actions > .primary-action")
        .length,
      1,
    );
    assert.equal(
      w.document.querySelector(".view-navigation [data-work-view=settings]"),
      null,
    );
    assert.equal(
      w.document.querySelector(".view-navigation [data-planner-view=month]"),
      null,
    );
    assert.ok(
      w.document.querySelector("#options-menu [data-work-view=settings]"),
    );
    click("Calendario");
    click("Mes");
    assert.equal(
      w.document
        .querySelector(".view-navigation [data-planner-view=week]")
        .getAttribute("aria-pressed"),
      "true",
    );
    click("Tareas");
    assert.ok(w.document.querySelector("#work-task-filters"));
    assert.ok(
      [...w.document.querySelectorAll("#task-list input[type=checkbox]")].every(
        (x) => x.hidden,
      ),
    );
    click("Seleccionar varias");
    assert.ok(
      [...w.document.querySelectorAll("#task-list input[type=checkbox]")].every(
        (x) => !x.hidden,
      ),
    );
  } finally {
    dom.window.close();
  }
});
test("settings uses weekday names and preserves scoring when saving basic hours", () => {
  const { dom, w, run, click } = app();
  try {
    click("Configuración");
    const form = w.document.querySelector("#work-view"),
      find = (label) =>
        [...form.querySelectorAll("label")]
          .find((x) => x.firstChild.textContent === label)
          .querySelector("input,select");
    find("Inicio habitual").value = "09:00";
    const sat = find("Sáb");
    sat.checked = true;
    sat.dispatchEvent(new w.Event("change"));
    click("Guardar configuración");
    assert.equal(run("workState.settings.start"), "09:00");
    assert.equal(run("workState.settings.weekdays.includes(6)"), true);
    assert.equal(run("workState.settings.weights.deadline"), 40);
  } finally {
    dom.window.close();
  }
});
