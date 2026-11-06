# Gestión de trabajo: implementación y operación

## Arquitectura conservada

La aplicación sigue siendo HTML, CSS y JavaScript estático, con Inter local, ical.js 2.2.1, Supabase Auth mediante GitHub y la restricción existente al ID inmutable del usuario autorizado. No se ha incorporado Microsoft Graph, OAuth de Outlook, sincronización de correo ni otro importador. El bloque original `parseCalendar` y sus manejadores de carga y eliminación se han conservado literalmente.

`work-engine.js` contiene reglas puras de prioridad, disponibilidad, conversión de zona horaria, planificación y recurrencias. `work-ui.js` conecta las fichas y las nuevas vistas con el estado existente. No hay datos de ejemplo en la aplicación.

Se conserva `planner_state.tasks`, `meeting_calendar` y la función antigua de guardado. La nueva columna `work_state` almacena proyectos, sesiones, propuestas, recurrencias, configuración e historial. La función `save_planner_state_v2` guarda los tres conjuntos en una operación atómica con comparación de revisión. La copia local incluye el nuevo estado por usuario. Los conflictos de entidades se combinan por identificador; comentarios y listas con ID también se combinan. Un conflicto sobre el mismo campo se notifica y conserva el valor local, como en la arquitectura previa.

Esta decisión evita trasladar los datos existentes a numerosas tablas en una sola actualización. El acceso se hace por la clave primaria de usuario; los filtros se calculan en el cliente. No se han añadido índices JSON sin consultas que los aprovechen. Es una solución para el volumen de un usuario, no una base normalizada preparada para colaboración masiva.

## Funciones disponibles

- Captura rápida, duración personalizada, fecha, prioridad manual y proyecto. Acceso con `Alt+N`.
- Tareas con estados, tipos, impacto, prioridad del responsable diferenciada del origen, dependencias con detección de ciclos, subtareas, etiquetas, espera de terceros y seguimiento.
- Edición, duplicación, completar/reabrir, borrado recuperable y archivo/recuperación, selección múltiple, búsqueda, filtros, ordenación y agrupación.
- Proyectos con objetivos, próximos pasos, estados, fechas, hitos y progreso estimado o manual.
- Documentación Markdown con guardado tras una pausa de escritura, versiones recuperables y vista previa sanitizada; comentarios con fecha/autor y registro de edición; checklists editables, reordenables y con progreso.
- Archivos múltiples con arrastrar y soltar, progreso por archivo, búsqueda, filtro por extensión y descripción, asociados a proyectos, tareas, plantillas y comentarios. Descarga, nombre visible modificable, vínculos estables `attachment:ID`, vista previa de PDF, imágenes y texto. Los archivos de Office se descargan.
- Prioridad explicada de 0 a 100 con pesos y umbrales de urgencia configurables, plazos laborables, antigüedad y dependencias.
- Propuesta automática al abrir Hoy y propuestas diarias/semanales con edición previa a la aceptación, agenda aceptada, margen libre, conflictos y tareas sin espacio. Sesiones largas divididas, bloques visuales de tareas rápidas y urgencias que prueban primero los huecos libres.
- Fijación, cambio manual de horario y arrastre de una sesión a un día del calendario, seguido de revisión del horario y comprobación de conflictos.
- Inicio, pausa, reanudación, finalización, tiempo manual y ajuste del restante. Las sesiones realizadas y canceladas conservan su historial.
- Jornadas, descansos, días laborables, festivos, franja preferida de concentración, horas objetivo y excepciones/ausencias, zona horaria y distribución de tiempo configurables.
- Recurrencias diarias laborables, semanales, mensuales, último día laborable e intervalo en días. Se generan próximos 60 días al abrir la sesión y al solicitarlo; IDs deterministas evitan duplicados. Las ejecuciones ya creadas no se sobrescriben al cambiar la plantilla.
- Calendario existente ampliado con sesiones, vencimientos, hitos, métricas mensuales/semanales, capacidad por semana y balance frente a las horas objetivo. El tiempo manual se incluye en las horas registradas.

## Base de datos y archivos

Para una instalación nueva, ejecutar primero `supabase/setup.sql` y después las migraciones `20261106065743_work_management.sql` y `20261106071835_attachment_formats.sql`, en ese orden.

En el proyecto existente **Planificador** (`xmwvatxklbafknkowhpg`), las dos migraciones ya se aplicaron durante este trabajo. Antes de aplicarla se ejecutó con `ROLLBACK` y se comprobó el rechazo de solapamientos. No hace falta volver a ejecutarla para usar ese proyecto.

El bucket `planner-files` es privado. Las descargas y eliminaciones requieren propietario e identidad GitHub autorizada. No existe política de carga directa para el cliente: las cargas pasan por la Edge Function `planner-upload`, ya desplegada en ese proyecto (versión 2).

La función verifica el token mediante `getUser(token)` y consulta el estado usando RLS antes de usar la credencial de servicio, disponible solamente en el servidor. El control JWT del gateway está desactivado porque la función autentica expresamente cada petición (también permite OPTIONS de CORS); esto no habilita cargas anónimas. Las pruebas comprueban el rechazo de tokens y usuarios no permitidos.

Se limita el tamaño antes de interpretar el formulario y se comprueban firmas, estructura ZIP de Office, correspondencia de extensión y entradas peligrosas. El máximo actual es 50 MB, reducible desde configuración. Los nombres internos son UUID y no dependen del nombre original. Al eliminar un adjunto compartido, se desvincula de esa ficha; el objeto solo se elimina cuando no quedan otras referencias cargadas.

`file-rules.js` y la copia en la función deben mantenerse idénticos; una prueba lo exige. Las bibliotecas nuevas del navegador son Marked 15.0.12 y DOMPurify 3.2.7, con licencias incluidas.

Para desplegar la función en otro proyecto, utilizar Supabase CLI o el despliegue de Edge Functions con `supabase/functions/planner-upload/index.ts` y `file-rules.js`. La configuración estándar del servidor proporciona `SUPABASE_URL`, `SUPABASE_ANON_KEY` y `SUPABASE_SERVICE_ROLE_KEY`. Nunca copiar esta última al frontend.

## Ejecución y comprobaciones

```sh
npm ci
npm test
npm run build
python3 -m http.server 8000 --directory dist
```

Node 24 se usa en las pruebas de la función TypeScript. El sitio publicado no necesita Node. También se puede servir directamente la carpeta fuente con un servidor estático.

Para probar el login desde una URL distinta de la de producción, esa URL debe estar autorizada en Supabase Auth. La configuración GitHub existente no se ha cambiado.

La acción de GitHub Pages ejecuta instalación, pruebas y empaquetado antes de publicar `dist/`. La primera versión se publicó en GitHub Pages mediante la PR #1. Las mejoras de experiencia se documentan en `DISENO.md`.

## Verificación y límites

Se ejecutan pruebas de motor, interfaz DOM, persistencia de snapshots, combinación concurrente de comentarios, importación ICS, recurrencias, validación de archivos y función de subida con clientes de autenticación/almacenamiento controlados. La compilación estática comprueba sintaxis y empaqueta los recursos reales.

Se verificaron en Supabase la columna nueva, el bucket privado, la ausencia de permisos anónimos de escritura y la ausencia de políticas de subida directa. El asesor de seguridad no detectó nuevos problemas de RLS; mantiene un aviso preexistente de protección de contraseñas filtradas desactivada, aunque esta aplicación usa GitHub: https://supabase.com/docs/guides/auth/password-security#password-strength-and-leaked-password-protection

Se ha realizado una revisión visual en Chromium real con datos locales controlados; véase `DISENO.md`. Sigue pendiente la subida/descarga de extremo a extremo con la sesión GitHub real del usuario.

Límites técnicos y comprobaciones pendientes:

- El planificador es una heurística determinista con prioridad de plazos, capacidad, continuidad, reserva y reutilización de horarios; no garantiza una solución óptima ni un mínimo global de movimientos. Las dependencias deben estar completadas antes de planificar la tarea sucesora.
- La propuesta automática se prepara al entrar en Hoy. Las recurrencias se generan al abrir la sesión o a petición; no hay un proceso que se ejecute con la aplicación cerrada.
- El balance de horas compara los registros del periodo con el objetivo configurado e incluye los días futuros del periodo; no es un sistema de fichaje ni de compensación aprobada de horas.
- La documentación permite imágenes adjuntas mediante `![descripción](attachment:ID)`. No carga imágenes externas ni edita documentos Office en línea.
- Los formatos admitidos incluyen Excel `.xlsx/.xls/.xlsb`, Word, PowerPoint, PDF, texto, CSV, PNG/JPEG/WebP y ZIP. Se bloquean ZIP cifrados, archivos comprimidos anidados, rutas inseguras, extensiones ejecutables y entradas VBA identificadas. La comprobación de formatos no es un escáner antimalware; no se ha conectado un servicio antivirus. Los formatos Office binarios antiguos se identifican por su contenedor OLE.
- El límite de carga es 50 MB y puede reducirse desde configuración. Aumentarlo requiere ajustar también el límite del bucket y de la función.
- Los cambios simultáneos de planificación incompatibles pueden ser rechazados por la validación de solapamientos del servidor; requieren revisar y replanificar. No hay una pantalla específica de resolución de conflictos.
- El borrado de tareas es recuperable desde Archivadas y conserva historial. No hay eliminación física de fichas ni recolector automático de archivos huérfanos.
- Queda pendiente el flujo completo con una sesión real del usuario. La revisión visual local y las pruebas automatizadas no sustituyen esa validación.
