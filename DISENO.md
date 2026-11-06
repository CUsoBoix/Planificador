# Una experiencia más sencilla y cuidada

## Criterios aplicados

La pantalla inicial se centra en el trabajo del día: un resumen compacto, una acción principal de planificación y dos zonas para agenda y prioridades. En móvil estas zonas se apilan. La captura pide tres campos; la ficha de tarea muestra cinco y mantiene los controles avanzados en secciones desplegables. Configuración y acciones ocasionales quedan fuera de la navegación principal.

Se conservan Inter local, controles nativos y toda la capacidad funcional. La jerarquía usa tamaño, peso, espacio y contraste: fondo suave, superficies blancas, azul reservado para acciones y foco visible. Los mensajes vacíos explican el siguiente paso. Las secciones abiertas se recuerdan mientras se trabaja en una ficha y los avisos se muestran dentro del diálogo activo.

## Investigación

Fuentes oficiales consultadas el 6 de noviembre de 2026:

- [Primer: progressive disclosure](https://github.com/primer/design/blob/main/content/ui-patterns/progressive-disclosure.mdx): revelar detalles conservando el contexto. Aplicado a fichas, ajustes y acciones secundarias.
- [Primer: empty states](https://github.com/primer/design/blob/main/content/ui-patterns/empty-states.mdx): explicar el estado y ofrecer un siguiente paso útil. Aplicado a agenda y prioridades vacías.
- [Primer: typography](https://github.com/primer/design/blob/main/content/foundations/typography.mdx): jerarquía legible, alineación y altura de línea. Aplicado al resumen y a las listas.
- [Carbon: action labels](https://github.com/carbon-design-system/carbon-website/blob/main/src/pages/guidelines/content/action-labels.mdx): etiquetas consistentes que anticipen el resultado. Aplicado a captura, guardado y planificación.
- [Fluent: focus indicators](https://github.com/microsoft/fluentui/blob/master/apps/public-docsite-v9/src/Concepts/Accessibility/FocusIndicator.mdx): conservar indicadores de foco perceptibles. Aplicado a controles, enlaces y desplegables.

Estas decisiones adaptan los principios al planificador; no añaden frameworks ni dependencias visuales externas.

## Validación

- 37 pruebas automatizadas aprobadas, incluyendo captura simplificada, conservación de campos avanzados, navegación y configuración.
- Empaquetado estático correcto.
- Chromium 153 real, con autenticación simulada y datos de prueba locales: navegación por las cinco secciones a 320, 390, 768 y 1440 px sin desbordamiento horizontal ni errores de JavaScript.
- Capturas de inicio y creación revisadas visualmente en escritorio y móvil. Acceso con Alt+N y cierre con Escape comprobados.
- El importador de calendario se conserva literalmente respecto a la versión original.

La comprobación local no sustituye una prueba de acceso y sincronización con la cuenta real del usuario. No se han introducido datos de prueba en producción.
