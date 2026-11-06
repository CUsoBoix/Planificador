# Planificador

Una lista sencilla de tareas y reuniones importadas. Las reuniones se cargan desde archivos `.ics` de Outlook.

Para abrirla, sirve esta carpeta con cualquier servidor estático. Por ejemplo:

```sh
python3 -m http.server 8000
```

Después, abre `http://localhost:8000` en el navegador.

La fuente Inter está incluida en `assets/fonts` y se distribuye bajo la licencia SIL Open Font License, incluida junto a los archivos de fuente.

## Importar reuniones desde Outlook LTSC 2021

En Outlook, abre el calendario y selecciona **Archivo → Guardar calendario**. Guarda el archivo en formato **iCalendar (.ics)**. En **Más opciones**, elige el periodo que quieras importar (la app muestra el próximo año) y un nivel de detalle que incluya el asunto. Después, en Planificador, abre **Opciones → Importar .ics** y selecciona ese archivo.

La página procesa el archivo en el navegador; no sube el `.ics` original ni guarda descripciones o asistentes. Sincroniza en Supabase solo el asunto, fecha, hora y ubicación de las reuniones futuras. Para reflejar cambios posteriores de Outlook, exporta y carga un archivo nuevo.

Las reuniones importadas se pueden consultar en las vistas **Semana** y **Mes**. Selecciona un día para ver su agenda; las tareas permanecen en su lista independiente.

El lector iCalendar incluido en `assets/vendor` es ical.js 2.2.1, con licencia Mozilla Public License 2.0 en `assets/vendor/ical.LICENSE`.

## Sincronización con GitHub y Supabase

La sincronización usa Supabase Auth con GitHub y una tabla privada con políticas RLS. El acceso a la base de datos está limitado al identificador inmutable del perfil GitHub **CUsoBoix** (`183085251`). Al iniciar sesión por primera vez, combina las tareas y reuniones que ya había en ese navegador con el estado de la nube. Después sincroniza cada cambio y carga las actualizaciones al volver a la página.

Si dos dispositivos guardan a la vez, la aplicación compara la revisión del servidor y combina cambios por identificador para evitar que un guardado antiguo reemplace todo el estado. La web no ofrece acceso anónimo.

Para activar el servicio:

1. Crea un proyecto en Supabase.
2. En GitHub, crea una OAuth App con la página principal `https://cusoboix.github.io/Planificador/` y callback `https://<project-ref>.supabase.co/auth/v1/callback`.
3. En Supabase, activa **Authentication → Providers → GitHub** y pega allí el Client ID y Client Secret de la OAuth App. El secreto se queda en Supabase; no lo pongas en este repositorio ni en `cloud-config.js`.
4. En **Authentication → URL Configuration**, configura la URL del sitio como `https://cusoboix.github.io/Planificador/` y permite esa misma URL como redirect.
5. Ejecuta [`supabase/setup.sql`](supabase/setup.sql) en el SQL Editor de Supabase. La política valida el ID de GitHub también en la base de datos.
6. En los ajustes de API del proyecto, copia la URL del proyecto y su clave **publishable** (o `anon`). Añádelas a `cloud-config.js` y publica el sitio.

La clave publishable está diseñada para aparecer en una app web. La seguridad depende de la política RLS del SQL; nunca uses la clave `service_role` en el navegador.

El cliente web incluido en `assets/vendor` es `@supabase/supabase-js` 2.119.0, con licencia MIT en `assets/vendor/supabase.LICENSE`.

## Gestión de trabajo y planificación

La ampliación incorpora Hoy, Proyectos, Recurrentes, configuración de jornada, fichas documentadas y propuestas de agenda. Consulta [IMPLEMENTACION.md](IMPLEMENTACION.md) para instalación, migración, pruebas, seguridad y límites verificados.

```sh
npm ci
npm test
npm run build
python3 -m http.server 8000 --directory dist
```
