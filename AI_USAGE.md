# Declaración de uso de inteligencia artificial — SmartHome

**Proyecto:** SmartHome · SENA ADSO, ficha 3145555
**Integrantes:** Karen Daniela Holguín Cruz (Karendaniela09), Natalia Chala Chala (nataliachala1), Kevin Stiven López Amaya (Kevin-Stiven-Lopez-Amaya404)
**Última actualización:** 2026-11-07

El equipo declara que usó herramientas de inteligencia artificial generativa como apoyo durante el desarrollo de SmartHome. Esta declaración identifica cada herramienta, su versión, para qué se usó, cuándo y qué revisó el equipo. Todo resultado de IA entró al repositorio mediante un *pull request* revisado y fusionado por un integrante, que es responsable de su contenido.

## Herramientas utilizadas

| Herramienta y versión | Proveedor | Uso en el proyecto | Periodo |
|---|---|---|---|
| Claude Opus 5.5 (Claude Code) | Anthropic | Redacción y reorganización de documentación técnica, corrección puntual de código, auditoría frente a la rúbrica de entrega y preparación de correcciones | 2026-11-03 a 2026-11-07 |
| GitHub Copilot (coding agent) | GitHub | Reemplazo de la instantánea local de la base de datos en la rama `03-dev` | 2026-10-08 |
| ChatGPT Codex (`chatgpt-codex-connector`) | OpenAI | Revisión automática de *pull requests* de la aplicación móvil (comentarios; no escribió código) | 2026-10-08 a 2026-10-09 |
| Figma Make | Figma | Generación del prototipo inicial de la interfaz web (componentes React base, luego reescritos por el equipo) | 2026-09 |

## Criterios del equipo

- Ninguna contraseña, token, llave ni dato personal real se compartió con las herramientas de IA.
- Las sugerencias de IA se aceptaron solo después de pasar *lint*, compilación y pruebas del CI del repositorio.
- La IA no tomó decisiones de arquitectura, de seguridad ni de alcance; estas las definió el equipo.
- El contenido generado con IA está identificado en el historial de Git mediante el autor `Claude` o la línea `Co-Authored-By` del commit.

## Commits de este repositorio con participación de IA

| Commit | Fecha | Herramienta | Descripción | Integrado por | Revisión del equipo |
|---|---|---|---|---|---|
| `dc79f00` | 2026-11-03 | Claude Opus 5.5 (coautor) | Reescritura del README del backend | PR #18, Karendaniela09 | Revisión del README por Karen |
| `2f00e1f` | 2026-11-03 | Claude Opus 5.5 (coautor) | Enlace del README a smart-home-doc | PR #18, Karendaniela09 | Revisión del README por Karen |
| Commits con `Co-Authored-By: Claude Opus 5.5` desde 2026-11-07 | 2026-11-07 | Claude Opus 5.5 (coautor) | Correcciones derivadas de la auditoría frente a la rúbrica de entrega final (ver mensaje de cada commit) | PR revisado y fusionado por un integrante | Revisión del diff y CI aprobado antes de fusionar |

## Verificación del equipo

Cada integrante revisó esta declaración y confirma que es completa:

- [ ] Karen Daniela Holguín Cruz
- [ ] Natalia Chala Chala
- [ ] Kevin Stiven López Amaya

## Referencias

Anthropic. (2026). *Claude Opus 5.5* [Modelo de lenguaje de gran tamaño]. https://www.anthropic.com/claude

Figma. (2025). *Figma Make* [Herramienta de generación de prototipos con IA]. https://www.figma.com/make/

GitHub. (2025). *GitHub Copilot coding agent* [Asistente de programación con IA]. https://github.com/features/copilot

OpenAI. (2025). *Codex* [Agente de programación con IA]. https://openai.com/codex/
