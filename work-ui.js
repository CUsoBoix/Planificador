/* UI adapter over the existing authenticated planner and calendar. */
(() => {
  "use strict";
  const E = WorkEngine,
    $ = (s) => document.querySelector(s),
    panel = $("#work-view"),
    dialog = $("#work-dialog");
  let view = "tasks",
    selectedDay = E.dateAt(Date.now()),
    filter = "Activas",
    sortBy = "Prioridad",
    groupBy = "Sin agrupar";
  const selectedTasks = new Set();
  let selecting = false;
  let initializedUser = null;
  const uid = () => crypto.randomUUID(),
    now = () => new Date().toISOString();
  const h = (tag, text, cls) => {
    const e = document.createElement(tag);
    if (text !== undefined) e.textContent = text;
    if (cls) e.className = cls;
    return e;
  };
  function button(text, fn, cls = "") {
    const b = h("button", text, cls);
    b.type = "button";
    b.addEventListener("click", async () => {
      try {
        await fn();
      } catch (e) {
        message(e.message, true);
      }
    });
    return b;
  }
  function message(text, error = false) {
    announcements.textContent = text;
    let p = $("#work-message");
    if (!p) {
      p = h("p");
      p.id = "work-message";
      p.setAttribute("role", "status");
      $(".work-toolbar").after(p);
    }
    let modalMessage = dialog.querySelector(".dialog-message");
    if (dialog.open) {
      if (!modalMessage) {
        modalMessage = h("p", undefined, "dialog-message");
        modalMessage.setAttribute("role", "status");
        dialog.children[0]?.after(modalMessage);
      }
      modalMessage.textContent = text;
      modalMessage.className = `dialog-message ${error ? "work-error" : "work-notice"}`;
    }
    p.textContent = text;
    p.className = error ? "work-error" : "work-notice";
  }
  function save(label = "Cambios guardados") {
    if (!cloudReady) throw Error("Espera a que se cargue tu sesión.");
    const localSaved = writeLocalSnapshot();
    queueCloudSync();
    render();
    message(
      localSaved
        ? label
        : "No se pudo guardar la copia local; comprueba el estado de sincronización.",
      !localSaved,
    );
  }
  function history(entity, action) {
    (entity.history ??= []).push({ id: uid(), at: now(), action });
  }
  function row(...children) {
    const e = h("div", undefined, "work-row");
    e.append(...children);
    return e;
  }
  function disclosure(label, expanded = false) {
    const details = h("details", undefined, "disclosure");
    details.open = expanded;
    details.append(h("summary", label));
    return details;
  }
  function moveFields(parent, inputs) {
    for (const input of inputs) parent.append(input.closest("label"));
  }
  function primary(control) {
    control.classList.add("primary-action");
    return control;
  }
  function field(parent, label, value = "", type = "text", choices) {
    const wrap = h("label", label, "work-field");
    const input = h(
      choices ? "select" : type === "textarea" ? "textarea" : "input",
    );
    if (choices)
      for (const option of choices) {
        const [v, t] = Array.isArray(option) ? option : [option, option];
        const o = h("option", t);
        o.value = v;
        input.append(o);
      }
    else if (type !== "textarea") input.type = type;
    input.value = value ?? "";
    wrap.append(input);
    parent.append(wrap);
    return input;
  }
  function number(parent, label, value, min = 0, max = 100000) {
    const e = field(parent, label, value, "number");
    e.min = min;
    e.max = max;
    e.step = 1;
    return e;
  }
  function check(parent, label, value) {
    const e = field(parent, label, "", "checkbox");
    e.checked = !!value;
    return e;
  }
  const projectOptions = () => [
    ["", "Sin proyecto"],
    ...workState.projects.map((p) => [p.id, p.text]),
  ];
  const dateLabel = (value) =>
    new Intl.DateTimeFormat("es-ES", {
      timeZone: workState.settings.timezone,
      day: "numeric",
      month: "short",
      hour: "2-digit",
      minute: "2-digit",
    }).format(new Date(value));
  let dialogKey = null;
  const expandedSections = new Map();
  function rememberSections() {
    if (dialogKey)
      expandedSections.set(
        dialogKey,
        [...dialog.querySelectorAll("details[open] > summary")].map(
          (x) => x.textContent,
        ),
      );
  }
  function restoreSections() {
    const expanded = expandedSections.get(dialogKey);
    if (!expanded) return;
    for (const details of dialog.querySelectorAll("details"))
      details.open = expanded.includes(
        details.querySelector("summary")?.textContent,
      );
  }
  function open(title, key = title) {
    rememberSections();
    dialogKey = key;
    dialog.replaceChildren(
      row(
        h("h2", title),
        button("Cerrar", () => dialog.close()),
      ),
    );
    if (!dialog.open) dialog.showModal();
  }
  function required(value, label) {
    if (!value.trim()) throw Error(`${label} es obligatorio.`);
    return value.trim();
  }
  function num(input) {
    if (!input.checkValidity())
      throw Error(`Revisa ${input.parentElement.firstChild.textContent}.`);
    return +input.value;
  }
  function complete(id) {
    const t = tasks.find((x) => x.id === id);
    if (!t) return;
    t.completed = !t.completed;
    t.status = t.completed ? "Completada" : "Pendiente";
    t.completedAt = t.completed ? now() : null;
    if (t.completed) {
      t.remaining = 0;
      for (const s of workState.sessions.filter(
        (x) => x.taskId === id && !["done", "cancelled"].includes(x.status),
      )) {
        if (s.status === "running") recordElapsed(s);
        s.status = "cancelled";
        history(s, "Cancelada al completar tarea");
      }
    } else t.remaining = t.estimated;
    history(t, t.status);
    save(
      t.completed
        ? "Tarea completada. Puedes actualizar su documentación cuando quieras."
        : "Tarea reabierta.",
    );
  }
  globalThis.completeWorkTask = complete;
  function quickTask() {
    open("Nueva tarea");
    const f = h("form");
    dialog.append(f);
    const title = field(f, "Título");
    title.required = true;
    title.maxLength = 240;
    const duration = number(f, "Duración estimada (min)", 30, 1, 100000);
    f.append(
      row(
        ...[5, 15, 30, 45, 60].map((n) =>
          button(`${n} min`, () => (duration.value = n)),
        ),
      ),
    );
    const due = field(f, "Fecha límite", "", "date");
    const options = disclosure("Añadir detalles");
    f.append(options);
    const priority = field(options, "Prioridad manual", 0, "text", [
      [0, "Automática"],
      [1, "Importante"],
      [2, "Urgente"],
    ]);
    const project = field(options, "Proyecto", "", "text", projectOptions());
    const immediate = check(options, "Ya está completada", false);
    const another = check(options, "Crear otra después", false);
    const submit = primary(h("button", "Crear tarea"));
    submit.type = "submit";
    f.append(submit);
    f.addEventListener("submit", (e) => {
      e.preventDefault();
      try {
        const minutes = num(duration),
          t = E.task({
            id: uid(),
            text: required(title.value, "El título"),
            estimated: minutes,
            remaining: immediate.checked ? 0 : minutes,
            due: due.value,
            manual: +priority.value,
            projectId: project.value,
            projectPriority:
              workState.projects.find((p) => p.id === project.value)
                ?.priority || 0,
            type:
              minutes <= workState.settings.quickLimit
                ? "Rápida"
                : "Concentración",
            completed: immediate.checked,
            completedAt: immediate.checked ? now() : null,
          });
        tasks.push(t);
        history(t, "Creada");
        save();
        if (another.checked) {
          title.value = "";
          title.focus();
        } else dialog.close();
      } catch (e) {
        message(e.message, true);
      }
    });
    title.focus();
  }
  $("#new-work-task").addEventListener("click", quickTask);
  document.addEventListener("keydown", (e) => {
    if (e.altKey && e.key.toLowerCase() === "n" && cloudReady) {
      e.preventDefault();
      quickTask();
    }
  });
  function attachments(entity, parent) {
    parent.append(h("h3", "Archivos"));
    const upload = field(parent, "Adjuntar archivos", "", "file");
    upload.multiple = true;
    upload.accept = workState.settings.extensions.map((x) => "." + x).join(",");
    const progress = h("progress");
    progress.hidden = true;
    progress.setAttribute("aria-label", "Archivos subidos");
    parent.append(progress);
    const uploadFiles = async (files) => {
      upload.disabled = true;
      progress.hidden = false;
      progress.max = files.length;
      progress.value = 0;
      try {
        for (const file of files) {
          await uploadFile(entity, file);
          save("Archivo guardado");
          progress.value++;
        }
        openEntity(entity);
      } catch (error) {
        message(error.message, true);
      } finally {
        upload.disabled = false;
        progress.hidden = true;
      }
    };
    upload.addEventListener("change", () => uploadFiles([...upload.files]));
    const drop = h("div", "Arrastra archivos aquí", "file-drop");
    drop.tabIndex = 0;
    drop.addEventListener("dragover", (event) => event.preventDefault());
    drop.addEventListener("drop", (event) => {
      event.preventDefault();
      uploadFiles([...event.dataTransfer.files]);
    });
    parent.append(drop);
    const search = field(parent, "Buscar archivo"),
      type = field(parent, "Tipo de archivo", "", "text", [
        ["", "Todos"],
        ...workState.settings.extensions,
      ]);
    const filterFiles = () => {
      for (const r of parent.querySelectorAll("[data-file-name]"))
        r.hidden = !(
          r.dataset.fileName.includes(search.value.toLowerCase()) &&
          (!type.value || r.dataset.fileExtension === type.value)
        );
    };
    search.addEventListener("input", filterFiles);
    type.addEventListener("change", filterFiles);
    for (const a of entity.attachments || [])
      parent.append(
        row(
          h(
            "span",
            `${a.name} · ${Math.ceil(a.size / 1024)} KB · ${dateLabel(a.createdAt)}${a.description ? " · " + a.description : ""}`,
          ),
          button("Descargar", () => download(a)),
          ...([
            "application/pdf",
            "image/png",
            "image/jpeg",
            "image/webp",
            "text/plain",
            "text/csv",
          ].includes(a.mime)
            ? [button("Vista previa", () => previewFile(a))]
            : []),
          button("Descripción", () => {
            const value = prompt(
              "Descripción del archivo",
              a.description || "",
            );
            if (value !== null) {
              a.description = value;
              save();
              openEntity(entity);
            }
          }),
          button("Renombrar", () => {
            const value = prompt("Nombre visible", a.name);
            if (value?.trim()) {
              a.name = value.trim();
              save();
              openEntity(entity);
            }
          }),
          button("Copiar vínculo", () =>
            navigator.clipboard.writeText(`attachment:${a.id}`),
          ),
          button("Eliminar", async () => {
            if (
              !confirm(
                "¿Eliminar este adjunto? Si está vinculado a otras fichas se conservará allí.",
              )
            )
              return;
            if (allAttachments().filter((x) => x.id === a.id).length === 1) {
              const { error } = await cloudClient.storage
                .from("planner-files")
                .remove([a.path]);
              if (error) throw error;
            }
            entity.attachments = entity.attachments.filter(
              (x) => x.id !== a.id,
            );
            history(entity, `Desvinculado ${a.name}`);
            save();
            openEntity(entity);
          }),
        ),
      );
    const rows = [...parent.children].filter((x) =>
      x.classList.contains("work-row"),
    );
    rows.forEach((r, index) => {
      const a = (entity.attachments || [])[index];
      if (a) {
        r.dataset.fileName = (
          a.name +
          " " +
          (a.description || "")
        ).toLowerCase();
        r.dataset.fileExtension = a.path.split(".").pop();
      }
    });
  }
  async function uploadFile(entity, file) {
    if (!cloudUser || !cloudReady)
      throw Error("Inicia sesión para subir archivos.");
    if (file.size > Math.min(50, workState.settings.maxFileMB) * 1024 * 1024)
      throw Error("El archivo supera el límite permitido.");
    WorkFiles.validate(
      file.name,
      new Uint8Array(await file.arrayBuffer()),
      workState.settings.maxFileMB * 1024 * 1024,
      workState.settings.extensions,
    );
    const body = new FormData();
    body.append("file", file);
    const { data, error } = await cloudClient.functions.invoke(
      "planner-upload",
      { body },
    );
    if (error) {
      let detail = "";
      try {
        detail = (await error.context.json()).error || "";
      } catch {}
      throw Error(detail || error.message);
    }
    if (data.error) throw Error(data.error);
    (entity.attachments ??= []).push(data);
    history(entity, `Adjunto ${file.name}`);
  }
  async function download(a) {
    const { data, error } = await cloudClient.storage
      .from("planner-files")
      .download(a.path);
    if (error) throw error;
    const link = h("a");
    link.href = URL.createObjectURL(data);
    link.download = a.name;
    link.click();
    setTimeout(() => URL.revokeObjectURL(link.href), 5000);
  }
  async function previewFile(a) {
    const { data, error } = await cloudClient.storage
      .from("planner-files")
      .download(a.path);
    if (error) throw error;
    open(a.name);
    if (a.mime.startsWith("text/")) {
      dialog.append(h("pre", await data.text()));
      return;
    }
    const url = URL.createObjectURL(data),
      preview = h(a.mime === "application/pdf" ? "iframe" : "img");
    preview.src = url;
    preview.style.width = "100%";
    preview.style.minHeight = "400px";
    if (a.mime === "application/pdf") {
      preview.setAttribute("sandbox", "");
      preview.title = a.name;
    } else preview.alt = a.name;
    dialog.append(preview);
    dialog.addEventListener("close", () => URL.revokeObjectURL(url), {
      once: true,
    });
  }
  function common(entity, parent) {
    if (
      ![...tasks, ...workState.projects, ...workState.recurrences].includes(
        entity,
      )
    ) {
      parent.append(
        h("p", "Guarda primero la ficha para añadir documentación y archivos."),
      );
      return;
    }
    const checklist = h("details");
    checklist.append(h("summary", "Checklist"));
    for (const item of entity.checklist || []) {
      const c = check(checklist, item.text, item.done);
      checklist.append(
        row(
          button("Editar punto", () => {
            const text = prompt("Punto de checklist", item.text);
            if (text?.trim()) {
              item.text = text.trim();
              save();
              openEntity(entity);
            }
          }),
          button("Subir punto", () => {
            const index = entity.checklist.indexOf(item);
            if (index > 0) {
              [entity.checklist[index - 1], entity.checklist[index]] = [
                entity.checklist[index],
                entity.checklist[index - 1],
              ];
              save();
              openEntity(entity);
            }
          }),
          button("Eliminar punto", () => {
            entity.checklist = entity.checklist.filter((x) => x.id !== item.id);
            save();
            openEntity(entity);
          }),
        ),
      );
      c.addEventListener("change", () => {
        item.done = c.checked;
        save();
        checklist.querySelector(".checklist-progress").textContent =
          `${entity.checklist.filter((x) => x.done).length} / ${entity.checklist.length} completados`;
      });
    }
    checklist.append(
      h(
        "p",
        `${(entity.checklist || []).filter((x) => x.done).length} / ${(entity.checklist || []).length} completados`,
        "checklist-progress",
      ),
    );
    const newItem = field(checklist, "Nuevo punto");
    checklist.append(
      button("Añadir punto", () => {
        (entity.checklist ??= []).push({
          id: uid(),
          text: required(newItem.value, "El punto"),
          done: false,
        });
        save();
        openEntity(entity);
      }),
    );
    parent.append(checklist);
    const docs = h("details");
    docs.append(h("summary", "Documentación"));
    const editor = field(docs, "Documento", entity.documents || "", "textarea");
    editor.rows = 10;
    let timer;
    const persistDoc = () => {
      if (editor.value === entity.documents) return;
      (entity.versions ??= []).push({
        id: uid(),
        at: now(),
        text: entity.documents || "",
      });
      entity.documents = editor.value;
      history(entity, "Documentación actualizada");
      save();
    };
    editor.addEventListener("input", () => {
      clearTimeout(timer);
      timer = setTimeout(persistDoc, 900);
    });
    editor.addEventListener("blur", () => {
      clearTimeout(timer);
      persistDoc();
    });
    docs.append(button("Guardar documentación", persistDoc));
    const preview = h("div", undefined, "document-preview");
    docs.append(
      button("Vista previa", async () => {
        const markdown = editor.value.replace(
          /!\[([^\]]*)\]\(attachment:([\w-]+)\)/g,
          (_, alt, id) =>
            `<img data-attachment-id="${id}" alt="${alt.replace(/[&<>"']/g, "")}">`,
        );
        preview.innerHTML = DOMPurify.sanitize(marked.parse(markdown), {
          FORBID_TAGS: ["style"],
          FORBID_ATTR: ["style", "src", "srcset"],
          USE_PROFILES: { html: true },
        });
        for (const img of preview.querySelectorAll("img")) {
          const a = allAttachments().find(
            (a) =>
              a.id === img.dataset.attachmentId && a.mime.startsWith("image/"),
          );
          if (!a) {
            img.remove();
            continue;
          }
          img.removeAttribute("src");
          const { data, error } = await cloudClient.storage
            .from("planner-files")
            .download(a.path);
          if (error) throw error;
          const url = URL.createObjectURL(data);
          img.src = url;
          dialog.addEventListener("close", () => URL.revokeObjectURL(url), {
            once: true,
          });
        }
        for (const link of preview.querySelectorAll("a")) {
          link.rel = "noopener noreferrer";
          link.target = "_blank";
        }
      }),
      preview,
    );
    const versions = disclosure("Versiones anteriores");
    if (entity.versions?.length) docs.append(versions);
    for (const version of [...(entity.versions || [])].reverse())
      versions.append(
        button(`Recuperar ${dateLabel(version.at)}`, () => {
          if (confirm("¿Recuperar esta versión? Se conservará la actual.")) {
            editor.value = version.text;
            persistDoc();
          }
        }),
      );
    for (const match of (entity.documents || "").matchAll(
      /attachment:([\w-]+)/g,
    )) {
      const a = allAttachments().find((a) => a.id === match[1]);
      if (a) docs.append(button(`Archivo: ${a.name}`, () => download(a)));
    }
    parent.append(docs);
    const comments = h("details");
    comments.append(h("summary", "Comentarios"));
    for (const c of entity.comments || []) {
      const block = h("article");
      block.append(
        h("small", `${dateLabel(c.at)} · ${c.author || "Usuario"}`),
        h("p", c.text),
        button("Editar", () => {
          const text = prompt("Comentario", c.text);
          if (text !== null) {
            (c.versions ??= []).push({ at: now(), text: c.text });
            c.text = text;
            save();
            openEntity(entity);
          }
        }),
      );
      attachments(c, block);
      comments.append(block);
    }
    const entry = field(comments, "Nuevo comentario", "", "textarea");
    comments.append(
      button("Comentar", () => {
        (entity.comments ??= []).push({
          id: uid(),
          at: now(),
          author: cloudUser?.user_metadata?.user_name || "Usuario",
          text: required(entry.value, "El comentario"),
          attachments: [],
        });
        history(entity, "Comentario añadido");
        save();
        openEntity(entity);
      }),
    );
    parent.append(comments);
    const files = h("details");
    files.append(h("summary", "Archivos adjuntos"));
    attachments(entity, files);
    parent.append(files);
    const logs = h("details");
    logs.append(h("summary", "Historial"));
    for (const event of [...(entity.history || [])].reverse())
      logs.append(h("p", `${dateLabel(event.at)} · ${event.action}`));
    parent.append(logs);
    restoreSections();
  }
  function allAttachments() {
    return [...tasks, ...workState.projects, ...workState.recurrences].flatMap(
      (x) => [
        ...(x.attachments || []),
        ...(x.comments || []).flatMap((c) => c.attachments || []),
      ],
    );
  }
  function openEntity(entity) {
    if (tasks.includes(entity)) taskDetail(entity.id);
    else if (workState.projects.includes(entity)) projectDetail(entity);
    else if (workState.recurrences.includes(entity)) recurrenceDetail(entity);
    else {
      const owner = [
        ...tasks,
        ...workState.projects,
        ...workState.recurrences,
      ].find((x) => (x.comments || []).includes(entity));
      if (owner) openEntity(owner);
    }
  }
  function taskDetail(id) {
    const t = tasks.find((t) => t.id === id);
    if (!t) return;
    open(t.text, t.id);
    const top = h("div", undefined, "work-grid");
    dialog.append(top);
    const advanced = disclosure("Más detalles y prioridad"),
      advancedGrid = h("div", undefined, "work-grid");
    advanced.append(advancedGrid);
    const followUp = disclosure(
        "Seguimiento de terceros",
        t.status === "En espera",
      ),
      followGrid = h("div", undefined, "work-grid");
    followUp.append(followGrid);
    const title = field(top, "Título", t.text);
    const status = field(top, "Estado", t.status, "text", [
      "Bandeja de entrada",
      "Pendiente",
      "En curso",
      "En espera",
      "Completada",
      "Cancelada",
    ]);
    const type = field(top, "Tipo", t.type, "text", [
      "Rápida",
      "Concentración",
      "Recurrente",
      "Administrativa",
      "Seguimiento",
    ]);
    const project = field(
      top,
      "Proyecto",
      t.projectId,
      "text",
      projectOptions(),
    );
    const estimate = number(top, "Estimación (min)", t.estimated, 1),
      remaining = number(top, "Tiempo restante (min)", t.remaining);
    const due = field(top, "Fecha límite", t.due, "date"),
      start = field(top, "Inicio permitido", t.startDate, "date");
    const hard = check(top, "Fecha inamovible", t.hardDue),
      boss = check(top, "Prioridad explícita de mi jefe", t.boss);
    const impact = number(top, "Impacto (0–5)", t.impact, 0, 5),
      manual = field(top, "Prioridad manual", t.manual, "text", [
        [0, "Automática"],
        [1, "Importante"],
        [2, "Urgente"],
      ]);
    const origin = field(top, "Origen", t.origin || "Manual", "text", [
      "Manual",
      "Responsable",
      "Compañero",
      "Correo",
      "Otro",
    ]);
    const requester = field(top, "Solicitante", t.requester);
    const waiting = field(top, "Motivo de espera", t.waitingReason),
      waitingPerson = field(top, "Esperando a", t.waitingPerson),
      follow = field(top, "Fecha de seguimiento", t.followUp, "date");
    const tags = field(
      top,
      "Etiquetas separadas por comas",
      (t.tags || []).join(", "),
    );
    const next = field(top, "Próximo paso", t.nextStep);
    const description = field(dialog, "Descripción", t.description, "textarea");
    moveFields(advancedGrid, [
      type,
      estimate,
      start,
      hard,
      boss,
      impact,
      manual,
      origin,
      requester,
      tags,
      next,
    ]);
    moveFields(followGrid, [waiting, waitingPerson, follow]);
    advanced.append(description.closest("label"));
    status.addEventListener("change", () => {
      if (status.value === "En espera") followUp.open = true;
    });
    dialog.append(advanced, followUp);
    const dependencies = h("details");
    dependencies.append(h("summary", "Dependencias"));
    const depFields = tasks
      .filter((a) => a.id !== id && !a.archived)
      .map((a) => [
        a.id,
        check(dependencies, a.text, (t.dependencies || []).includes(a.id)),
      ]);
    advanced.append(dependencies);
    const score = E.priority(t, tasks, workState.settings);
    advanced.append(
      h(
        "p",
        `Prioridad automática: ${score.score}/100 · ${Object.entries(
          score.reasons,
        )
          .map(
            ([k, v]) =>
              `${{ deadline: "plazo", boss: "responsable", impact: "impacto", dependencies: "dependencias", age: "antigüedad" }[k]} ${v.toFixed(1)}`,
          )
          .join(" · ")}`,
      ),
    );
    const taskActions = row(
      primary(
        button("Guardar resumen", () => {
          const deps = depFields.filter(([, c]) => c.checked).map(([id]) => id);
          const reaches = (id, seen = new Set()) => {
            if (id === t.id) return true;
            if (seen.has(id)) return false;
            seen.add(id);
            return (tasks.find((x) => x.id === id)?.dependencies || []).some(
              (x) => reaches(x, seen),
            );
          };
          if (deps.some((x) => reaches(x)))
            throw Error("Las dependencias crearían un ciclo.");
          Object.assign(t, {
            text: required(title.value, "El título"),
            status: status.value,
            type: type.value,
            projectId: project.value,
            projectPriority:
              workState.projects.find((p) => p.id === project.value)
                ?.priority || 0,
            estimated: num(estimate),
            remaining: num(remaining),
            due: due.value,
            startDate: start.value,
            hardDue: hard.checked,
            boss: boss.checked,
            impact: num(impact),
            manual: +manual.value,
            origin: origin.value,
            requester: requester.value,
            waitingReason: waiting.value,
            waitingPerson: waitingPerson.value,
            followUp: follow.value,
            tags: tags.value
              .split(",")
              .map((x) => x.trim())
              .filter(Boolean),
            nextStep: next.value,
            description: description.value,
            dependencies: deps,
          });
          if ((status.value === "Completada") !== t.completed) complete(t.id);
          t.status = status.value;
          if (status.value === "Cancelada")
            for (const session of workState.sessions.filter(
              (x) =>
                x.taskId === t.id && !["done", "cancelled"].includes(x.status),
            )) {
              recordElapsed(session);
              session.status = "cancelled";
              history(session, "Cancelada con la tarea");
            }
          history(
            t,
            "Resumen actualizado; revisar planificación si cambió el plazo",
          );
          save();
          taskDetail(id);
        }),
      ),
      button(t.completed ? "Reabrir" : "Completar", () => {
        complete(id);
        taskDetail(id);
      }),
      button(t.archived ? "Recuperar" : "Archivar", () => {
        t.archived = !t.archived;
        if (!t.archived) t.deletedAt = null;
        history(t, t.archived ? "Archivada" : "Recuperada");
        save();
        taskDetail(id);
      }),
      button("Duplicar", () => {
        const copy = E.task({
          ...structuredClone(t),
          id: uid(),
          text: t.text + " (copia)",
          completed: false,
          status: "Pendiente",
          actual: 0,
          remaining: t.estimated,
          createdAt: now(),
          history: [],
          comments: [],
          archived: false,
        });
        tasks.push(copy);
        save();
        taskDetail(copy.id);
      }),
    );
    taskActions.classList.add("task-main-actions");
    top.after(taskActions);
    const more = disclosure("Más acciones");
    dialog.append(more);
    more.append(...[...taskActions.children].slice(2));
    more.append(
      button("Eliminar tarea", () => {
        if (
          !confirm(
            "¿Eliminar esta tarea? Podrás recuperarla desde Archivadas; su historial se conserva.",
          )
        )
          return;
        t.archived = true;
        t.deletedAt = now();
        for (const session of workState.sessions.filter(
          (s) => s.taskId === t.id && !["done", "cancelled"].includes(s.status),
        )) {
          recordElapsed(session);
          session.status = "cancelled";
          history(session, "Cancelada al eliminar la tarea");
        }
        history(t, "Eliminada (recuperable)");
        save();
        dialog.close();
      }),
    );
    const subtasks = disclosure("Subtareas"),
      time = disclosure("Tiempo y sesiones");
    dialog.append(subtasks, time);
    const sub = field(subtasks, "Nueva subtarea");
    subtasks.append(
      button("Crear subtarea", () => {
        const child = E.task({
          id: uid(),
          text: required(sub.value, "El título"),
          parentId: id,
          projectId: t.projectId,
        });
        tasks.push(child);
        save();
        taskDetail(child.id);
      }),
    );
    for (const child of tasks.filter((a) => a.parentId === id))
      subtasks.append(button(child.text, () => taskDetail(child.id)));
    const manualTime = number(time, "Registrar minutos realizados", 15, 1);
    time.append(
      button("Registrar tiempo", () => {
        const n = num(manualTime);
        t.actual += n;
        (t.timeEntries ??= []).push({
          id: uid(),
          at: now(),
          minutes: n,
          source: "manual",
        });
        t.remaining = Math.max(0, t.remaining - n);
        history(t, `${n} min registrados manualmente`);
        save();
        taskDetail(id);
      }),
    );
    time.append(h("p", `Tiempo realizado: ${Math.round(t.actual)} min`));
    for (const s of workState.sessions.filter((s) => s.taskId === id))
      time.append(h("p", `${dateLabel(s.start)} · ${s.status}`));
    common(t, dialog);
  }
  globalThis.openWorkTask = taskDetail;
  function progress(p) {
    const children = tasks.filter((t) => t.projectId === p.id && !t.archived),
      total = children.reduce((n, t) => n + t.estimated, 0);
    return (
      p.manualProgress ??
      (total
        ? Math.round(
            (children
              .filter((t) => t.completed)
              .reduce((n, t) => n + t.estimated, 0) *
              100) /
              total,
          )
        : 0)
    );
  }
  function projectDetail(p) {
    open(p.text || "Nuevo proyecto", p.id);
    const form = h("div", undefined, "work-grid");
    dialog.append(form);
    const title = field(form, "Nombre", p.text),
      status = field(form, "Estado", p.status || "Pendiente", "text", [
        "Pendiente",
        "En curso",
        "En espera",
        "Completado",
        "Archivado",
      ]),
      due = field(form, "Vencimiento", p.due, "date"),
      start = field(form, "Inicio", p.start, "date"),
      priority = number(form, "Prioridad (0–5)", p.priority || 3, 0, 5),
      manual = field(
        form,
        "Progreso manual (vacío = automático)",
        p.manualProgress ?? "",
        "number",
      );
    manual.min = 0;
    manual.max = 100;
    const goal = field(dialog, "Objetivo", p.goal, "textarea"),
      description = field(dialog, "Descripción", p.description, "textarea"),
      next = field(dialog, "Próximos pasos", p.nextStep, "textarea");
    const projectDetails = disclosure("Más detalles del proyecto");
    moveFields(projectDetails, [start, priority, manual, description, next]);
    dialog.append(projectDetails);
    dialog.append(
      primary(
        button("Guardar proyecto", () => {
          Object.assign(p, {
            text: required(title.value, "El nombre"),
            status: status.value,
            due: due.value,
            start: start.value,
            priority: num(priority),
            manualProgress: manual.value === "" ? null : num(manual),
            goal: goal.value,
            description: description.value,
            nextStep: next.value,
          });
          if (!workState.projects.includes(p)) workState.projects.push(p);
          for (const t of tasks.filter((t) => t.projectId === p.id))
            t.projectPriority = p.priority;
          history(p, "Proyecto actualizado");
          save();
          projectDetail(p);
        }),
      ),
    );
    dialog.append(h("p", `Progreso: ${progress(p)}%`));
    for (const t of tasks.filter((t) => t.projectId === p.id))
      dialog.append(
        button(`${t.completed ? "✓ " : ""}${t.text}`, () => taskDetail(t.id)),
      );
    if (workState.projects.includes(p)) {
      const milestones = h("details");
      milestones.append(h("summary", "Hitos del proyecto"));
      for (const milestone of p.milestones || [])
        milestones.append(
          row(
            h("span", `${milestone.date} · ${milestone.text}`),
            button("Eliminar hito", () => {
              if (confirm("¿Eliminar este hito?")) {
                p.milestones = p.milestones.filter(
                  (x) => x.id !== milestone.id,
                );
                save();
                projectDetail(p);
              }
            }),
          ),
        );
      const milestoneTitle = field(milestones, "Nombre del hito"),
        milestoneDate = field(milestones, "Fecha del hito", "", "date");
      milestones.append(
        button("Añadir hito", () => {
          if (!milestoneDate.value) throw Error("Indica la fecha del hito");
          (p.milestones ??= []).push({
            id: uid(),
            text: required(milestoneTitle.value, "El hito"),
            date: milestoneDate.value,
          });
          history(p, "Hito añadido");
          save();
          projectDetail(p);
        }),
      );
      dialog.append(milestones);
    }
    common(p, dialog);
  }
  function recurrenceDetail(r) {
    open(r.text || "Nueva recurrencia", r.id);
    const grid = h("div", undefined, "work-grid");
    dialog.append(grid);
    const title = field(grid, "Nombre", r.text),
      frequency = field(grid, "Frecuencia", r.frequency || "Semanal", "text", [
        "Diaria",
        "Semanal",
        "Mensual",
        "Personalizada",
      ]),
      start = field(grid, "Fecha de inicio", r.start || selectedDay, "date"),
      end = field(grid, "Fecha de fin", r.end, "date"),
      duration = number(grid, "Duración (min)", r.estimated || 30, 1),
      offset = number(grid, "Plazo: días después", r.dueOffset || 0),
      month = number(grid, "Día del mes", r.monthDay || 1, 1, 31),
      interval = number(
        grid,
        "Intervalo personalizado (días)",
        r.interval || 1,
        1,
      ),
      project = field(grid, "Proyecto", r.projectId, "text", projectOptions());
    const weekdays = field(
        grid,
        "Días semanales (1=lunes, 0=domingo)",
        (r.weekdays || [1]).join(","),
      ),
      last = check(grid, "Último día laborable del mes", r.lastWorkday),
      active = check(grid, "Activa", r.active !== false);
    const recurrenceDetails = disclosure("Más opciones de la repetición");
    moveFields(recurrenceDetails, [end, offset, project, active]);
    dialog.append(recurrenceDetails);
    const updateFrequency = () => {
      weekdays.closest("label").hidden = frequency.value !== "Semanal";
      month.closest("label").hidden = frequency.value !== "Mensual";
      last.closest("label").hidden = frequency.value !== "Mensual";
      interval.closest("label").hidden = frequency.value !== "Personalizada";
    };
    frequency.addEventListener("change", updateFrequency);
    updateFrequency();
    dialog.append(
      button("Guardar plantilla", () => {
        const days = weekdays.value.split(",").map(Number);
        if (days.some((x) => !Number.isInteger(x) || x < 0 || x > 6))
          throw Error("Días no válidos.");
        Object.assign(r, {
          text: required(title.value, "El nombre"),
          frequency: frequency.value,
          start: required(start.value, "La fecha de inicio"),
          end: end.value,
          estimated: num(duration),
          dueOffset: num(offset),
          monthDay: num(month),
          interval: num(interval),
          projectId: project.value,
          projectPriority:
            workState.projects.find((p) => p.id === project.value)?.priority ||
            0,
          weekdays: days,
          lastWorkday: last.checked,
          active: active.checked,
        });
        if (!workState.recurrences.includes(r)) workState.recurrences.push(r);
        history(r, "Plantilla actualizada");
        generateRecurrences();
        save();
        recurrenceDetail(r);
      }),
    );
    common(r, dialog);
  }
  function generateRecurrences() {
    let n = 0;
    for (const r of workState.recurrences)
      for (const t of E.occurrences(r, selectedDay, 60, workState.settings))
        if (!tasks.some((a) => a.id === t.id)) {
          tasks.push(t);
          n++;
        }
    return n;
  }
  function recordElapsed(s) {
    if (!s.startedAt) return;
    const elapsed = Math.max(0, (Date.now() - Date.parse(s.startedAt)) / 60000),
      t = tasks.find((t) => t.id === s.taskId);
    if (t) {
      t.actual += elapsed;
      (t.timeEntries ??= []).push({
        id: uid(),
        at: now(),
        minutes: elapsed,
        source: "session",
        sessionId: s.id,
      });
      t.remaining = Math.max(0, t.remaining - elapsed);
      history(t, `${elapsed.toFixed(1)} min de sesión`);
    }
    s.actual = (s.actual || 0) + elapsed;
    s.startedAt = null;
  }
  function sessionRow(s, preview = false) {
    const t = tasks.find((t) => t.id === s.taskId),
      r = row(
        h(
          "time",
          `${dateLabel(s.start)} — ${new Intl.DateTimeFormat("es", { timeZone: workState.settings.timezone, hour: "2-digit", minute: "2-digit" }).format(new Date(s.end))}`,
        ),
        button(t?.text || "Bloque reservado", () =>
          t ? taskDetail(t.id) : undefined,
        ),
        h(
          "small",
          `${s.kind === "quick" ? "Tareas rápidas" : "Concentración"}${s.status === "running" ? " · En curso" : s.status === "paused" ? " · En pausa" : s.status === "done" ? " · Realizada" : ""}${s.locked ? " · Fijada" : ""}`,
        ),
      );
    r.classList.add("session", s.kind || "focus");
    if (!preview && s.status === "accepted") {
      r.draggable = true;
      r.addEventListener("dragstart", (event) =>
        event.dataTransfer.setData("text/plain", s.id),
      );
    }
    if (!preview && !["done", "cancelled"].includes(s.status)) {
      r.append(
        button(s.locked ? "Desbloquear" : "Fijar", () => {
          s.locked = !s.locked;
          history(s, s.locked ? "Fijada" : "Desbloqueada");
          save();
        }),
        button("Editar horario", () => editSession(s)),
        button(
          s.status === "running"
            ? "Pausar"
            : s.status === "paused"
              ? "Reanudar"
              : "Iniciar",
          () => {
            if (s.status === "running") {
              recordElapsed(s);
              s.status = "paused";
            } else {
              if (workState.sessions.some((x) => x.status === "running"))
                throw Error("Pausa la otra sesión antes de empezar.");
              s.startedAt = now();
              s.status = "running";
            }
            save();
          },
        ),
        button("Finalizar sesión", () => {
          recordElapsed(s);
          s.status = "done";
          s.finishedAt = now();
          if (
            Date.now() < Date.parse(s.end) &&
            Date.now() > Date.parse(s.start)
          )
            s.end = now();
          history(s, "Sesión finalizada");
          save();
        }),
        button("Cancelar", () => {
          if (!confirm("¿Cancelar esta sesión? Se conservará en el historial."))
            return;
          recordElapsed(s);
          s.status = "cancelled";
          history(s, "Cancelada manualmente");
          save();
        }),
      );
      if (s.status === "running" && Date.now() > Date.parse(s.end))
        r.append(
          h(
            "strong",
            "Tiempo previsto superado. Revisa las siguientes sesiones.",
          ),
        );
    }
    if (!preview && !["done", "cancelled"].includes(s.status)) {
      const actions = [...r.children]
          .filter((x) => x.tagName === "BUTTON")
          .slice(1),
        more = disclosure("Opciones de la sesión");
      for (const control of actions) {
        if (["Iniciar", "Reanudar", "Pausar"].includes(control.textContent))
          primary(control);
        else if (
          control.textContent !== "Finalizar sesión" ||
          s.status === "accepted"
        )
          more.append(control);
      }
      r.append(more);
    }
    return r;
  }
  function editSession(s = { id: uid(), status: "accepted", kind: "focus" }) {
    open("Horario manual");
    const taskInput = field(dialog, "Tarea", s.taskId, "text", [
      ["", "Reserva manual"],
      ...tasks.filter((t) => !t.completed).map((t) => [t.id, t.text]),
    ]);
    const date = field(
      dialog,
      "Fecha",
      s.start ? E.dateAt(s.start, workState.settings.timezone) : selectedDay,
      "date",
    );
    const start = field(
        dialog,
        "Hora de inicio",
        s.start
          ? new Intl.DateTimeFormat("en-GB", {
              timeZone: workState.settings.timezone,
              hour: "2-digit",
              minute: "2-digit",
            }).format(new Date(s.start))
          : "09:00",
        "time",
      ),
      duration = number(
        dialog,
        "Duración (min)",
        s.end ? (Date.parse(s.end) - Date.parse(s.start)) / 60000 : 60,
        1,
      );
    dialog.append(
      button("Guardar bloque fijado", () => {
        if (!date.value || !start.value) throw Error("Indica fecha y hora.");
        const begin = E.wall(
            date.value,
            start.value,
            workState.settings.timezone,
          ),
          end = begin + num(duration) * 60000;
        const free = E.availability(
          date.value,
          workState.settings,
          meetingCalendar?.meetings,
          workState.sessions.filter((x) => x.id !== s.id),
        );
        if (!free.some(([a, b]) => begin >= a && end <= b))
          throw Error(
            "El bloque se solapa con otro compromiso o está fuera de jornada.",
          );
        const t = tasks.find((x) => x.id === taskInput.value);
        if (
          t &&
          (t.status === "En espera" ||
            t.dependencies.some(
              (id) => !tasks.find((x) => x.id === id)?.completed,
            ) ||
            (t.startDate && date.value < t.startDate))
        )
          throw Error("La tarea aún no está disponible.");
        Object.assign(s, {
          taskId: taskInput.value,
          start: new Date(begin).toISOString(),
          end: new Date(end).toISOString(),
          locked: true,
        });
        const existing = workState.sessions.find((x) => x.id === s.id);
        if (existing && existing !== s) Object.assign(existing, s);
        else if (!existing) workState.sessions.push(s);
        history(s, "Horario fijado manualmente");
        save();
        dialog.close();
      }),
    );
  }
  function proposal(days = 1, replan = false, urgent = false) {
    generateRecurrences();
    const p = E.plan({
      from: selectedDay,
      days,
      tasks,
      meetings: meetingCalendar?.meetings || [],
      sessions: workState.sessions,
      config: workState.settings,
      now: now(),
      replan,
      urgent,
    });
    p.id = uid();
    p.baseRevision = cloudLocalRevision;
    workState.proposals.push(p);
    save("Propuesta preparada; la agenda aceptada no se ha modificado.");
    showProposal(p);
  }
  function showProposal(p) {
    open("Propuesta de planificación");
    dialog.append(
      h(
        "p",
        `${Math.round(p.used)} min planificados · ${Math.round(p.reserve)} min reservados para imprevistos · ${Math.round(p.capacity)} min de capacidad`,
      ),
    );
    for (const warning of p.warnings)
      dialog.append(h("p", warning, "work-error"));
    for (const change of p.changes) {
      const t = tasks.find((t) => t.id === change.taskId);
      dialog.append(
        h(
          "p",
          `Cancelar bloque anterior: ${t?.text || ""}, ${dateLabel(change.start)}`,
        ),
      );
    }
    for (const s of p.sessions) {
      dialog.append(sessionRow(s, true));
      if (p.status === "proposed")
        dialog.append(
          button("Modificar sesión propuesta", () => editProposalSession(p, s)),
        );
    }
    for (const u of p.unscheduled)
      dialog.append(
        h(
          "p",
          `${tasks.find((t) => t.id === u.taskId)?.text || ""}: ${u.reason} (${Math.round(u.minutes)} min)`,
        ),
      );
    if (p.status === "proposed")
      dialog.append(
        row(
          button("Aceptar planificación", () => accept(p)),
          button("Rechazar", () => {
            p.status = "rejected";
            save();
            dialog.close();
          }),
        ),
      );
  }
  function editProposalSession(p, session) {
    open("Modificar propuesta");
    const date = field(
        dialog,
        "Fecha",
        E.dateAt(session.start, workState.settings.timezone),
        "date",
      ),
      time = field(
        dialog,
        "Hora",
        new Intl.DateTimeFormat("en-GB", {
          timeZone: workState.settings.timezone,
          hour: "2-digit",
          minute: "2-digit",
        }).format(new Date(session.start)),
        "time",
      ),
      duration = number(
        dialog,
        "Duración (min)",
        (Date.parse(session.end) - Date.parse(session.start)) / 60000,
        1,
      );
    dialog.append(
      button("Guardar cambio en propuesta", () => {
        const task = tasks.find((t) => t.id === session.taskId);
        if (
          date.value < p.from ||
          date.value >= E.dayAdd(p.from, p.days) ||
          (task?.startDate && date.value < task.startDate) ||
          (task?.due && date.value > task.due)
        )
          throw Error(
            "La fecha está fuera del intervalo permitido o del plazo de la tarea.",
          );
        const start = E.wall(
            date.value,
            time.value,
            workState.settings.timezone,
          ),
          minutes = num(duration),
          end = start + minutes * 60000;
        const fixed = workState.sessions.filter(
          (s) => s.id !== session.id && !p.changes.some((c) => c.id === s.id),
        );
        const free = E.availability(
          date.value,
          workState.settings,
          meetingCalendar?.meetings || [],
          [...fixed, ...p.sessions.filter((s) => s !== session)],
          Date.now(),
        );
        if (!free.some(([a, b]) => start >= a && end <= b))
          throw Error(
            "El horario se solapa o está fuera de la jornada disponible.",
          );
        const other = p.sessions
          .filter((s) => s !== session && s.taskId === session.taskId)
          .reduce(
            (n, s) => n + (Date.parse(s.end) - Date.parse(s.start)) / 60000,
            0,
          );
        const reserved = fixed
          .filter(
            (s) =>
              s.taskId === session.taskId &&
              ["accepted", "running", "paused"].includes(s.status),
          )
          .reduce(
            (n, s) =>
              n +
              Math.max(
                0,
                (Date.parse(s.end) - Date.parse(s.start)) / 60000 -
                  (s.actual || 0),
              ),
            0,
          );
        if (task && other + minutes + reserved > task.remaining)
          throw Error("Las sesiones superan el tiempo restante de la tarea.");
        const previous = workState.sessions.find((s) => s.id === session.id);
        if (previous && !p.changes.some((c) => c.id === previous.id))
          p.changes.push({
            id: previous.id,
            taskId: previous.taskId,
            start: previous.start,
            action: "cancel",
          });
        const oldMinutes =
          (Date.parse(session.end) - Date.parse(session.start)) / 60000;
        const missing = p.unscheduled.find((u) => u.taskId === session.taskId);
        if (missing)
          missing.minutes = Math.max(0, missing.minutes + oldMinutes - minutes);
        else if (oldMinutes > minutes)
          p.unscheduled.push({
            taskId: session.taskId,
            minutes: oldMinutes - minutes,
            reason: "Duración reducida manualmente",
          });
        p.unscheduled = p.unscheduled.filter((u) => u.minutes > 0);
        Object.assign(session, {
          id: uid(),
          start: new Date(start).toISOString(),
          end: new Date(end).toISOString(),
          batchId: null,
          locked: true,
        });
        p.used = p.sessions.reduce(
          (n, s) => n + (Date.parse(s.end) - Date.parse(s.start)) / 60000,
          0,
        );
        p.free = p.capacity - p.used;
        if (p.free < p.reserve)
          p.warnings.push("El ajuste manual reduce la reserva de imprevistos.");
        history(p, "Horario propuesto editado manualmente");
        save("Propuesta modificada; la agenda sigue sin cambios.");
        showProposal(p);
      }),
    );
  }
  function accept(p) {
    if (p.changes.some((c) => Date.parse(c.start) <= Date.now()))
      throw Error(
        "Un bloque que se iba a mover ya ha comenzado. Regenera la propuesta.",
      );
    const current = JSON.stringify({
      raw: tasks,
      meetings: meetingCalendar?.meetings || [],
      sessions: workState.sessions,
      config: workState.settings,
    });
    if (current !== p.signature)
      throw Error(
        "Los datos han cambiado desde la propuesta. Genera una nueva para evitar conflictos.",
      );
    if (p.sessions.some((s) => Date.parse(s.start) < Date.now()))
      throw Error(
        "La propuesta contiene horas pasadas. Regenera con la disponibilidad actual.",
      );
    for (const c of p.changes) {
      const s = workState.sessions.find((x) => x.id === c.id);
      if (s) {
        s.status = "cancelled";
        history(s, "Cancelada por replanificación aceptada");
      }
    }
    for (const session of p.sessions) {
      const existing = workState.sessions.find((x) => x.id === session.id);
      if (existing) {
        if (existing.status === "cancelled")
          Object.assign(existing, session, { status: "accepted" });
      } else
        workState.sessions.push({
          ...session,
          status: "accepted",
          proposalId: p.id,
        });
    }
    p.status = "accepted";
    p.acceptedAt = now();
    workState.history.push({
      id: uid(),
      at: now(),
      action: `Planificación aceptada: ${p.sessions.length} sesiones`,
    });
    save("Planificación aceptada");
    dialog.close();
  }
  function todayPanel() {
    if (
      selectedDay === E.dateAt(Date.now(), workState.settings.timezone) &&
      tasks.some((t) => !t.completed && !t.archived) &&
      !workState.sessions.some(
        (s) =>
          s.status !== "cancelled" &&
          E.dateAt(s.start, workState.settings.timezone) === selectedDay,
      ) &&
      !workState.proposals.some(
        (p) => p.from === selectedDay && p.status === "proposed",
      )
    ) {
      const p = E.plan({
        from: selectedDay,
        days: 1,
        tasks,
        meetings: meetingCalendar?.meetings || [],
        sessions: workState.sessions,
        config: workState.settings,
        now: now(),
      });
      p.id = uid();
      workState.proposals.push(p);
      writeLocalSnapshot();
      queueCloudSync();
    }
    const overview = h("section", undefined, "today-overview");
    const heading = h("div", undefined, "today-heading");
    const greeting = h("div");
    greeting.append(
      h("h2", "Un día con foco"),
      h("p", "Tu jornada, con espacio para lo importante.", "work-subtitle"),
    );
    heading.append(greeting);
    overview.append(heading);
    panel.append(overview);
    const date = field(heading, "Día de planificación", selectedDay, "date");
    date.addEventListener("change", () => {
      if (date.value) {
        selectedDay = date.value;
        renderWork();
      }
    });
    const pending = tasks.filter(
      (t) => !t.completed && !t.archived && !["Cancelada"].includes(t.status),
    );
    const metric = (value, label) => {
      const item = h("div", undefined, "metric");
      item.append(h("strong", String(value)), h("span", label));
      return item;
    };
    const metrics = row(
      metric(pending.length, "Tareas pendientes"),
      metric(
        pending.filter((t) => t.due && t.due < selectedDay).length,
        "Fuera de plazo",
      ),
      metric(
        workState.projects.filter((p) => p.status === "En curso").length,
        "Proyectos en curso",
      ),
    );
    metrics.classList.add("today-metrics");
    overview.append(metrics);
    const recent = [...workState.proposals]
      .reverse()
      .find((p) => p.from === selectedDay && p.status === "proposed");
    const actions = row();
    actions.classList.add("today-actions");
    const more = disclosure("Ajustar mi día");
    const generate = button("Generar planificación", () => proposal());
    if (recent) {
      actions.append(
        primary(
          button("Revisar propuesta pendiente", () => showProposal(recent)),
        ),
      );
      more.append(generate);
    } else actions.append(primary(generate));
    more.append(
      button("Regenerar", () => proposal()),
      button("Replanificar pendientes", () => proposal(1, true)),
      button("Urgencia: usar margen libre", () => proposal(1, true, true)),
      button("Editar manualmente", () => editSession()),
    );
    actions.append(more);
    overview.append(actions);
    const reserve = E.availability(
      selectedDay,
      workState.settings,
      meetingCalendar?.meetings || [],
      workState.sessions,
    ).reduce((n, [a, b]) => n + (b - a) / 60000, 0);
    overview.append(
      h(
        "p",
        `${Math.round(reserve)} min disponibles · Tú decides cuándo aceptar una nueva planificación.`,
        "today-hint",
      ),
    );
    const columns = h("div", undefined, "today-columns");
    const agenda = h("section", undefined, "today-agenda");
    const priorities = h("section", undefined, "today-priorities");
    columns.append(agenda, priorities);
    panel.append(columns);
    const items = [
      ...workState.sessions.filter(
        (s) =>
          s.status !== "cancelled" &&
          E.dateAt(s.start, workState.settings.timezone) === selectedDay,
      ),
      ...(meetingCalendar?.meetings || [])
        .filter(
          (m) =>
            E.dateAt(m.start, workState.settings.timezone) <= selectedDay &&
            E.dateAt(m.end, workState.settings.timezone) >= selectedDay,
        )
        .map((m) => ({ ...m, meeting: true })),
    ].sort((a, b) => Date.parse(a.start) - Date.parse(b.start));
    for (const session of items.filter((x) => !x.meeting))
      if (
        items.some(
          (m) =>
            m.meeting &&
            Date.parse(m.start) < Date.parse(session.end) &&
            Date.parse(m.end) > Date.parse(session.start),
        )
      )
        panel.append(
          h(
            "p",
            `Conflicto: ${tasks.find((t) => t.id === session.taskId)?.text || "Reserva"} coincide con una reunión importada. Revisa el horario o replanifica.`,
            "work-error",
          ),
        );
    agenda.append(h("h3", "Tu agenda"));
    if (!items.length)
      agenda.append(
        h(
          "p",
          "Tu agenda está despejada. Genera una planificación para reservar tiempo a tus tareas.",
          "empty-state",
        ),
      );
    let batchId = null,
      batchContainer = null;
    for (const item of items) {
      if (item.batchId && !item.meeting) {
        if (batchId !== item.batchId) {
          batchId = item.batchId;
          batchContainer = h("section", undefined, "quick-batch");
          batchContainer.append(h("h4", "Bloque de tareas rápidas"));
          agenda.append(batchContainer);
        }
        batchContainer.append(sessionRow(item));
      } else {
        batchId = null;
        agenda.append(
          item.meeting
            ? h(
                "p",
                `${dateLabel(item.start)} · ${item.title} · Reunión importada`,
                "meeting-block",
              )
            : sessionRow(item),
        );
      }
    }
    priorities.append(h("h3", "Para avanzar hoy"));
    if (!pending.length)
      priorities.append(
        h(
          "p",
          "Todo al día. Añade una tarea cuando tengas algo nuevo entre manos.",
          "empty-state",
        ),
      );
    for (const t of pending
      .sort(
        (a, b) =>
          E.priority(b, tasks, workState.settings).score -
          E.priority(a, tasks, workState.settings).score,
      )
      .slice(0, 5))
      priorities.append(taskRow(t));
  }
  function taskRow(t) {
    const completeButton = button(
      t.completed ? "✓" : "○",
      () => complete(t.id),
      "task-complete-control",
    );
    completeButton.setAttribute(
      "aria-label",
      `${t.completed ? "Reabrir" : "Completar"} ${t.text}`,
    );
    return row(
      completeButton,
      button(t.text, () => taskDetail(t.id), "work-task-title"),
      h(
        "small",
        `${Math.round(t.remaining)} min${t.due ? " · Vence " + new Intl.DateTimeFormat("es", { day: "numeric", month: "short" }).format(new Date(t.due + "T12:00:00")) : ""}${t.status === "En espera" ? " · En espera" : ""}`,
      ),
    );
  }
  function settingsPanel() {
    const s = workState.settings,
      form = h("div", undefined, "work-grid");
    panel.append(form);
    const zone = field(form, "Zona horaria", s.timezone),
      targetHours = number(
        form,
        "Horas objetivo diarias",
        s.targetHours,
        1,
        16,
      ),
      holidays = field(
        form,
        "Festivos (AAAA-MM-DD, separados por comas)",
        s.holidays.join(","),
      ),
      focusStart = field(
        form,
        "Concentración preferida desde",
        s.focusStart,
        "time",
      ),
      focusEnd = field(
        form,
        "Concentración preferida hasta",
        s.focusEnd,
        "time",
      ),
      start = field(form, "Inicio habitual", s.start, "time"),
      end = field(form, "Fin habitual", s.end, "time"),
      weekdays = field(
        form,
        "Días laborables (1=lun…0=dom)",
        s.weekdays.join(","),
      ),
      breaks = field(
        form,
        "Descansos (HH:MM-HH:MM; …)",
        s.breaks.map((b) => `${b.start}-${b.end}`).join(";"),
      ),
      focus = number(form, "Concentración (%)", s.focus, 0, 100),
      quick = number(form, "Tareas rápidas (%)", s.quick, 0, 100),
      reserve = number(form, "Imprevistos (%)", s.reserve, 0, 100),
      session = number(form, "Sesión preferida (min)", s.session, 15, 240),
      minimum = number(form, "Intervalo mínimo (min)", s.minimum, 1, 60),
      limit = number(
        form,
        "Umbral de tarea rápida (min)",
        s.quickLimit,
        5,
        120,
      ),
      maxfile = number(
        form,
        "Tamaño máximo de archivo (MB)",
        s.maxFileMB,
        1,
        50,
      );
    const extensions = field(
      form,
      "Extensiones admitidas (separadas por comas)",
      s.extensions.join(","),
    );
    const schedule = disclosure("Descansos, festivos y zona horaria"),
      planning = disclosure("Preferencias de planificación"),
      scoring = disclosure("Criterios de prioridad"),
      files = disclosure("Archivos");
    for (const section of [schedule, planning, scoring, files]) {
      const content = h("div", undefined, "work-grid");
      section.append(content);
      section.content = content;
      panel.append(section);
    }
    moveFields(schedule.content, [zone, holidays, breaks]);
    moveFields(planning.content, [
      focusStart,
      focusEnd,
      focus,
      quick,
      reserve,
      session,
      minimum,
      limit,
    ]);
    moveFields(files.content, [maxfile, extensions]);
    weekdays.closest("label").hidden = true;
    const days = h("fieldset", undefined, "weekday-picker");
    days.append(h("legend", "Días de trabajo"));
    form.append(days);
    const dayInputs = [
      ["Lun", 1],
      ["Mar", 2],
      ["Mié", 3],
      ["Jue", 4],
      ["Vie", 5],
      ["Sáb", 6],
      ["Dom", 0],
    ].map(([label, value]) => {
      const control = check(days, label, s.weekdays.includes(value));
      return [control, value];
    });
    for (const [control] of dayInputs)
      control.addEventListener("change", () => {
        weekdays.value = dayInputs
          .filter(([c]) => c.checked)
          .map(([, v]) => v)
          .join(",");
      });
    const urgency = {};
    for (const [key, label] of Object.entries({
      overdue: "Vencida",
      today: "Vence hoy",
      tomorrow: "Próximo día laborable",
      soon: "2–3 días laborables",
      week: "4–5 días laborables",
    }))
      urgency[key] = number(
        scoring.content,
        `Urgencia: ${label}`,
        s.urgency[key],
        0,
        40,
      );
    const weights = {};
    for (const [key, label] of Object.entries({
      deadline: "Vencimiento",
      boss: "Prioridad del responsable",
      impact: "Impacto",
      dependencies: "Dependencias",
      age: "Antigüedad",
    }))
      weights[key] = number(
        scoring.content,
        `Peso: ${label}`,
        s.weights[key],
        0,
        100,
      );
    panel.append(
      button("Guardar configuración", () => {
        const wd = weekdays.value.split(",").map(Number);
        if (wd.some((x) => !Number.isInteger(x) || x < 0 || x > 6))
          throw Error("Días laborables no válidos");
        const b = breaks.value.trim()
          ? breaks.value.split(";").map((v) => {
              const [start, end] = v.trim().split("-");
              if (!/^\d{2}:\d{2}$/.test(start) || !/^\d{2}:\d{2}$/.test(end))
                throw Error("Formato de descanso no válido");
              return { start, end };
            })
          : [];
        const value = {
          ...s,
          timezone: zone.value,
          targetHours: num(targetHours),
          holidays: holidays.value
            .split(",")
            .map((x) => x.trim())
            .filter(Boolean),
          focusStart: focusStart.value,
          focusEnd: focusEnd.value,
          start: start.value,
          end: end.value,
          weekdays: wd,
          breaks: b,
          focus: num(focus),
          quick: num(quick),
          reserve: num(reserve),
          session: num(session),
          minimum: num(minimum),
          quickLimit: num(limit),
          maxFileMB: num(maxfile),
          extensions: extensions.value
            .split(",")
            .map((x) => x.trim().replace(/^\./, "").toLowerCase())
            .filter(Boolean),
          urgency: Object.fromEntries(
            Object.entries(urgency).map(([k, v]) => [k, num(v)]),
          ),
          weights: Object.fromEntries(
            Object.entries(weights).map(([k, v]) => [k, num(v)]),
          ),
        };
        if (
          value.holidays.some(
            (d) =>
              !/^\d{4}-\d{2}-\d{2}$/.test(d) || !Number.isFinite(Date.parse(d)),
          )
        )
          throw Error("Formato de festivos no válido.");
        if (value.extensions.some((x) => !WorkFiles.types[x]))
          throw Error("La lista incluye extensiones no admitidas.");
        E.validateSettings(value);
        workState.settings = value;
        save();
      }),
    );
    panel.append(h("h3", "Excepción por fecha / ausencia"));
    const ex = h("div", undefined, "work-grid");
    panel.append(ex);
    const date = field(ex, "Fecha", selectedDay, "date"),
      a = field(ex, "Inicio", s.start, "time"),
      b = field(ex, "Fin", s.end, "time"),
      off = check(ex, "Ausencia / día no laborable", false);
    panel.append(
      button("Guardar excepción", () => {
        if (!date.value || b.value <= a.value)
          throw Error("Revisa la fecha y horario.");
        s.exceptions[date.value] = {
          start: a.value,
          end: b.value,
          off: off.checked,
        };
        save();
      }),
    );
    for (const [d, x] of Object.entries(s.exceptions))
      panel.append(
        row(
          h("span", `${d}: ${x.off ? "Ausencia" : x.start + "–" + x.end}`),
          button("Quitar excepción", () => {
            delete s.exceptions[d];
            save();
          }),
        ),
      );
  }
  function renderWork() {
    if (!cloudReady) return;
    if (initializedUser !== cloudUser?.id) {
      initializedUser = cloudUser?.id;
      selectedDay = E.dateAt(Date.now(), workState.settings.timezone);
      if (generateRecurrences()) {
        writeLocalSnapshot();
        queueCloudSync();
      }
    }
    if (view === "tasks") {
      renderTaskFilters();
      return;
    }
    panel.replaceChildren();
    if (view === "today") todayPanel();
    if (view === "projects") {
      panel.append(
        button("+ Nuevo proyecto", () =>
          projectDetail({
            id: uid(),
            comments: [],
            checklist: [],
            history: [],
            attachments: [],
          }),
        ),
      );
      for (const p of workState.projects)
        panel.append(
          row(
            button(p.text, () => projectDetail(p)),
            h(
              "span",
              `${p.status} · ${progress(p)}%${p.due ? " · " + p.due : ""}`,
            ),
          ),
        );
      if (!workState.projects.length)
        panel.append(
          h(
            "p",
            "Organiza un objetivo de largo recorrido en tu primer proyecto.",
          ),
        );
    }
    if (view === "recurrences") {
      panel.append(
        row(
          button("+ Nueva plantilla", () =>
            recurrenceDetail({ id: uid(), history: [] }),
          ),
          button("Generar próximos 60 días", () => {
            const n = generateRecurrences();
            save(`${n} tareas generadas sin duplicados`);
          }),
        ),
      );
      for (const r of workState.recurrences)
        panel.append(
          row(
            button(r.text, () => recurrenceDetail(r)),
            h("span", `${r.frequency} · ${r.active ? "Activa" : "Inactiva"}`),
          ),
        );
    }
    if (view === "settings") settingsPanel();
  }
  function renderTaskFilters() {
    let bar = $("#work-task-filters");
    if (!bar) {
      bar = h("div", undefined, "work-toolbar");
      bar.id = "work-task-filters";
      tasksView.prepend(bar);
    }
    bar.replaceChildren();
    const select = field(bar, "Estado", filter, "text", [
      "Activas",
      "Todas",
      "Archivadas",
      "Bandeja de entrada",
      "Pendiente",
      "En curso",
      "En espera",
      "Completada",
      "Cancelada",
    ]);
    select.addEventListener("change", () => {
      filter = select.value;
      renderTaskFilters();
    });
    const filters = disclosure("Ordenar y agrupar");
    bar.append(filters);
    const sort = field(filters, "Orden", sortBy, "text", [
      "Prioridad",
      "Vencimiento",
      "Duración",
      "Creación",
    ]);
    sort.addEventListener("change", () => {
      sortBy = sort.value;
      renderTaskFilters();
    });
    const group = field(filters, "Agrupar", groupBy, "text", [
      "Sin agrupar",
      "Proyecto",
      "Estado",
      "Tipo",
    ]);
    group.addEventListener("change", () => {
      groupBy = group.value;
      renderTaskFilters();
    });
    bar.append(
      button(selecting ? "Terminar selección" : "Seleccionar varias", () => {
        selecting = !selecting;
        if (!selecting) selectedTasks.clear();
        renderTaskFilters();
      }),
    );
    const bulk = row();
    bulk.hidden = !selecting;
    bar.append(bulk);
    bulk.append(
      button("Completar seleccionadas", () => {
        for (const id of selectedTasks) {
          const t = tasks.find((x) => x.id === id);
          if (t && !t.completed) complete(id);
        }
        selectedTasks.clear();
        renderTaskFilters();
      }),
      button("Archivar seleccionadas", () => {
        for (const id of selectedTasks) {
          const t = tasks.find((x) => x.id === id);
          if (t) {
            t.archived = true;
            history(t, "Archivada en lote");
          }
        }
        selectedTasks.clear();
        save();
      }),
    );
    const query = $("#work-search").value.toLowerCase();
    const results = tasks
      .filter(
        (t) =>
          (filter === "Todas" || filter === "Archivadas"
            ? filter === "Todas" || t.archived
            : !t.archived &&
              (filter === "Activas"
                ? !t.completed && t.status !== "Cancelada"
                : t.status === filter)) &&
          [t.text, t.description, t.documents, ...(t.tags || [])]
            .join(" ")
            .toLowerCase()
            .includes(query),
      )
      .sort(
        (a, b) =>
          (+b.manual || 0) - (+a.manual || 0) ||
          E.priority(b, tasks, workState.settings).score -
            E.priority(a, tasks, workState.settings).score,
      );
    if (sortBy === "Vencimiento")
      results.sort((a, b) => (a.due || "9999").localeCompare(b.due || "9999"));
    if (sortBy === "Duración")
      results.sort((a, b) => a.remaining - b.remaining);
    if (sortBy === "Creación")
      results.sort((a, b) => a.createdAt.localeCompare(b.createdAt));
    const groupKey = (t) =>
      groupBy === "Proyecto"
        ? workState.projects.find((p) => p.id === t.projectId)?.text ||
          "Sin proyecto"
        : groupBy === "Estado"
          ? t.status
          : groupBy === "Tipo"
            ? t.type
            : "";
    if (groupBy !== "Sin agrupar")
      results.sort((a, b) => groupKey(a).localeCompare(groupKey(b)));
    list.replaceChildren();
    let last = null;
    for (const t of results) {
      const key = groupKey(t);
      if (key && key !== last) {
        const header = h("li");
        header.append(h("h3", key));
        list.append(header);
        last = key;
      }
      const li = h("li"),
        line = taskRow(t),
        select = h("input");
      select.type = "checkbox";
      select.checked = selectedTasks.has(t.id);
      select.setAttribute("aria-label", `Seleccionar ${t.text}`);
      select.addEventListener("change", () =>
        select.checked ? selectedTasks.add(t.id) : selectedTasks.delete(t.id),
      );
      select.hidden = !selecting;
      line.prepend(select);
      li.append(line);
      list.append(li);
    }
    emptyState.hidden = !!results.length;
    count.textContent = `${results.length} tareas`;
  }
  globalThis.renderWork = renderWork;
  globalThis.hideWork = () => {
    panel.hidden = true;
    view = "tasks";
    document
      .querySelectorAll("[data-work-view]")
      .forEach((b) => b.setAttribute("aria-pressed", "false"));
  };
  function show(v) {
    view = v;
    tasksView.hidden = true;
    calendarViewSection.hidden = true;
    panel.hidden = false;
    pageTitle.textContent = {
      today: "Hoy",
      projects: "Proyectos",
      recurrences: "Recurrentes",
      settings: "Configuración",
    }[v];
    document.title = `${pageTitle.textContent} — Planificador`;
    document
      .querySelectorAll(".view-button")
      .forEach((b) =>
        b.setAttribute("aria-pressed", String(b.dataset.workView === v)),
      );
    renderWork();
  }
  globalThis.openWorkHome = () => show("today");
  document.querySelectorAll("[data-work-view]").forEach((b) =>
    b.addEventListener("click", () => {
      optionsMenu.open = false;
      show(b.dataset.workView);
    }),
  );
  $("#work-search").addEventListener("input", () => {
    setPlannerView("tasks");
    renderTaskFilters();
    const query = $("#work-search").value.toLowerCase();
    if (query)
      for (const p of workState.projects.filter((p) =>
        [p.text, p.documents, p.description]
          .join(" ")
          .toLowerCase()
          .includes(query),
      ))
        list.append(
          row(
            h("small", "Proyecto"),
            button(p.text, () => projectDetail(p)),
          ),
        );
  });
  globalThis.renderWorkCalendar = (days) => {
    if (!cloudReady) return;
    for (const [index, cell] of [
      ...calendarGrid.querySelectorAll(".calendar-day"),
    ].entries()) {
      const day = dateKey(days[index]);
      cell.addEventListener("dragover", (event) => event.preventDefault());
      cell.addEventListener("drop", (event) => {
        event.preventDefault();
        const session = workState.sessions.find(
          (s) =>
            s.id === event.dataTransfer.getData("text/plain") &&
            s.status === "accepted",
        );
        if (!session) return;
        const time = new Intl.DateTimeFormat("en-GB", {
            timeZone: workState.settings.timezone,
            hour: "2-digit",
            minute: "2-digit",
          }).format(new Date(session.start)),
          start = E.wall(day, time, workState.settings.timezone),
          end = start + Date.parse(session.end) - Date.parse(session.start);
        editSession({
          ...session,
          start: new Date(start).toISOString(),
          end: new Date(end).toISOString(),
        });
      });
      const sessions = workState.sessions.filter(
          (s) =>
            s.status !== "cancelled" &&
            E.dateAt(s.start, workState.settings.timezone) === day,
        ),
        due = tasks.filter((t) => !t.completed && !t.archived && t.due === day);
      if (
        workState.settings.holidays.includes(day) ||
        workState.settings.exceptions[day]?.off ||
        !workState.settings.weekdays.includes(E.weekday(day))
      )
        cell.classList.add("work-day-off");
      if (sessions.length)
        cell.append(
          h(
            "small",
            `${sessions.length} sesiones · ${Math.round(sessions.reduce((n, s) => n + (Date.parse(s.end) - Date.parse(s.start)) / 60000, 0))} min`,
            "work-calendar-label",
          ),
        );
      for (const project of workState.projects)
        for (const milestone of project.milestones || [])
          if (milestone.date === day)
            cell.append(
              h("small", `Hito: ${milestone.text}`, "work-calendar-label"),
            );
      for (const t of due.slice(0, 2))
        cell.append(h("small", `Plazo: ${t.text}`, "work-calendar-label"));
    }
    let extra = $("#work-calendar-agenda");
    if (!extra) {
      extra = h("div");
      extra.id = "work-calendar-agenda";
      calendarViewSection.append(extra);
    }
    extra.replaceChildren();
    extra.append(
      row(
        button("Propuesta semanal", () => {
          selectedDay = dateKey(days[0]);
          proposal(7);
        }),
        button("Añadir bloque manual", () => {
          selectedDay = dateKey(selectedCalendarDate);
          editSession();
        }),
      ),
    );
    for (const s of workState.sessions.filter(
      (s) =>
        s.status !== "cancelled" &&
        E.dateAt(s.start, workState.settings.timezone) ===
          dateKey(selectedCalendarDate),
    ))
      extra.append(sessionRow(s));
    const end = dateKey(days.at(-1)),
      start = dateKey(days[0]),
      inPeriod = (t) =>
        t.completedAt &&
        E.dateAt(t.completedAt, workState.settings.timezone) >= start &&
        E.dateAt(t.completedAt, workState.settings.timezone) <= end;
    const periodSessions = workState.sessions.filter(
      (s) =>
        s.status !== "cancelled" &&
        E.dateAt(s.start, workState.settings.timezone) >= start &&
        E.dateAt(s.start, workState.settings.timezone) <= end,
    );
    const planned = periodSessions.reduce(
        (n, s) => n + (Date.parse(s.end) - Date.parse(s.start)) / 60000,
        0,
      ),
      actual = tasks
        .flatMap((t) => t.timeEntries || [])
        .filter(
          (e) =>
            E.dateAt(e.at, workState.settings.timezone) >= start &&
            E.dateAt(e.at, workState.settings.timezone) <= end,
        )
        .reduce((n, e) => n + e.minutes, 0);
    const report = disclosure(
      calendarView === "month" ? "Resumen del mes" : "Resumen de la semana",
    );
    report.append(
      h("h3", calendarView === "month" ? "Resumen mensual" : "Resumen semanal"),
    );
    report.append(
      h(
        "p",
        `${workState.projects.filter((p) => p.status === "En curso").length} proyectos activos · ${workState.projects.filter((p) => p.status === "Completado").length} proyectos finalizados · ${tasks.filter((t) => !t.completed && !t.archived).length} tareas pendientes · ${tasks.filter((t) => !t.completed && !t.archived && t.due && t.due < E.dateAt(Date.now(), workState.settings.timezone)).length} vencidas`,
      ),
    );
    report.append(
      h(
        "p",
        `${(planned / 60).toFixed(1)} h previstas · ${(actual / 60).toFixed(1)} h registradas · ${(periodSessions.filter((s) => s.kind === "focus").reduce((n, s) => n + (s.actual || 0), 0) / 60).toFixed(1)} h de concentración · ${(periodSessions.filter((s) => s.kind === "quick").reduce((n, s) => n + (s.actual || 0), 0) / 60).toFixed(1)} h de tareas rápidas`,
      ),
    );
    let targetTotal = 0;
    const table = h("table"),
      header = h("tr");
    for (const label of ["Semana", "Capacidad neta", "Sin asignar", "Objetivo"])
      header.append(h("th", label));
    table.append(header);
    for (let i = 0; i < days.length; i += 7) {
      const week = days.slice(i, i + 7);
      let capacity = 0,
        free = 0,
        working = 0;
      for (const d of week) {
        const key = dateKey(d),
          net = E.availability(
            key,
            workState.settings,
            meetingCalendar?.meetings || [],
            [],
          );
        capacity += net.reduce((n, [a, b]) => n + (b - a) / 60000, 0);
        free += E.availability(
          key,
          workState.settings,
          meetingCalendar?.meetings || [],
          workState.sessions,
        ).reduce((n, [a, b]) => n + (b - a) / 60000, 0);
        if (net.length) working++;
      }
      targetTotal += working * workState.settings.targetHours;
      const line = h("tr");
      for (const value of [
        dateKey(week[0]),
        `${(capacity / 60).toFixed(1)} h`,
        `${(free / 60).toFixed(1)} h`,
        `${working * workState.settings.targetHours} h`,
      ])
        line.append(h("td", value));
      table.append(line);
    }
    report.append(table);
    report.append(
      h(
        "p",
        `Balance del periodo frente al objetivo: ${(actual / 60 - targetTotal).toFixed(1)} h (incluye días aún no trabajados).`,
      ),
    );
    report.append(
      h(
        "p",
        `${workState.proposals.filter((p) => p.status === "accepted" && p.from >= start && p.from <= end).reduce((n, p) => n + p.changes.length, 0)} bloques reprogramados en el periodo`,
      ),
    );
    extra.append(report);
    extra.append(
      h(
        "p",
        `${tasks.filter(inPeriod).length} tareas completadas en el periodo · ${tasks.filter((t) => !t.completed && !t.archived && t.due && t.due >= start && t.due <= end).length} vencimientos pendientes`,
      ),
    );
  };
  renderWork();
})();
