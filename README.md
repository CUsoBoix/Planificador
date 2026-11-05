# Planificador

Una lista de tareas sencilla. No necesita instalación ni servicios externos; las tareas se guardan en el almacenamiento local del navegador.

Para abrirla, sirve esta carpeta con cualquier servidor estático. Por ejemplo:

```sh
python3 -m http.server 8000
```

Después, abre `http://localhost:8000` en el navegador.

La fuente Inter está incluida en `assets/fonts` y se distribuye bajo la licencia SIL Open Font License, incluida junto a los archivos de fuente.

## Importar reuniones desde Outlook LTSC 2021

En Outlook, abre el calendario y selecciona **Archivo → Guardar calendario**. Guarda el archivo en formato **iCalendar (.ics)**. En **Más opciones**, elige el periodo que quieras importar (la app muestra el próximo año) y un nivel de detalle que incluya el asunto. Después, en Planificador, pulsa **Importar .ics** y selecciona ese archivo.

La página procesa el archivo en el navegador y guarda localmente el asunto, la fecha, la hora y la ubicación de las reuniones futuras. No sincroniza cambios posteriores de Outlook; para actualizar la lista, exporta y carga un archivo nuevo. En cada navegador las reuniones se guardan por separado.

El lector iCalendar incluido en `assets/vendor` es ical.js 2.2.1, con licencia Mozilla Public License 2.0 en `assets/vendor/ical.LICENSE`.
