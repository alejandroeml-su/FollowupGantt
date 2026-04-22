# Especificación Maestra: Enterprise Work Orchestration Platform
**Versión:** 1.0  
**Autor:** Senior Product Owner (CSPO, SAFe POPM)
**Frameworks:** Agile (Scrum/Kanban), PMI (PMP), ITIL v4, SAFe.

---

## 1. Definición Estratégica del Producto
Plataforma integral de orquestación de trabajo diseñada para centralizar la demanda y gestionar el flujo de valor. Permite la coexistencia de metodologías adaptativas (Agile) y predictivas (PMI/Waterfall), integrando la gestión de servicios (ITIL) en un único ecosistema de datos.

### Propuesta de Valor
- **Visibilidad 360°:** Desde el ticket operativo hasta el hito ejecutivo.
- **Sincronización Híbrida:** Alineación automática entre el Backlog ágil y el Cronograma de Gantt.
- **Gobernanza de Datos:** Métricas integradas de rendimiento y cumplimiento.

---

## 2. Release Plan (Roadmap de 3 Horizontes)

| Horizonte | Release | Enfoque Principal | Plazo |
| :--- | :--- | :--- | :--- |
| **H1** | Core Engine & Agility | Motor de BD, Kanban Boards, Sprints, Roles básicos. | Mes 1-3 |
| **H2** | Governance & Predictability | Gantt Dinámico, Dependencias, Baselines (PMI). | Mes 4-6 |
| **H3** | Service Excellence | Módulo ITIL, SLA Engine, BI Dashboards, APIs. | Mes 7-9 |

---

## 3. Backlog de Producto: Épicas e Historias de Usuario

### Épica 1: Motor de Orquestación Universal (Core)

#### User Story 1.1: Visualización Multimodal
**Como** Project Manager Híbrido, **quiero** alternar entre una vista de Kanban y una de Gantt con un solo clic, **para** gestionar el flujo diario sin perder de vista los hitos del cronograma.
- **AC1:** Sincronización bidireccional en tiempo real (un cambio en Kanban actualiza Gantt).
- **AC2:** Definición de "Hitos" (Milestones) visibles en ambas interfaces.
- **AC3:** Soporte para drag-and-drop en la línea de tiempo.

#### User Story 1.2: Gestión de WIP Limits
**Como** Scrum Master, **quiero** configurar límites de trabajo en progreso por columna, **para** identificar cuellos de botella y optimizar el Cycle Time.
- **AC1:** Alerta visual de saturación (cambio de color en columna).
- **AC2:** Registro de eventos de excedente para análisis en el CFD.

---

### Épica 2: Marco de Gobernanza PMI

#### User Story 2.1: Gestión de Dependencias y Ruta Crítica
**Como** PMP Certified Manager, **quiero** establecer dependencias (FS, SS, FF, SF), **para** calcular automáticamente la ruta crítica del proyecto.
- **AC1:** Visualización de dependencias en el diagrama de Gantt.
- **AC2:** Cálculo automático de la "Holgura" (Slack).
- **AC3:** Notificación automática a responsables por retrasos en predecesoras.

#### User Story 2.2: Líneas Base (Baselines)
**Como** Stakeholder Ejecutivo, **quiero** guardar una línea base del cronograma, **para** comparar el progreso real contra la planificación original.
- **AC1:** Almacenamiento de hasta 3 versiones de Baseline.
- **AC2:** Reporte de varianza (Schedule Variance - SV).

---

### Épica 3: Ecosistema ITIL (Service Management)

#### User Story 3.1: Gestión de SLA por Prioridad
**Como** Service Desk Manager, **quiero** que el sistema asigne tiempos de respuesta/resolución automáticos, **para** cumplir con los acuerdos de nivel de servicio.
- **AC1:** Cronómetro de cuenta regresiva visible por ticket.
- **AC2:** Escalamiento automático al superar el 80% del tiempo permitido.

---

## 4. Plan de Pruebas de Aceptación (UAT)

| ID | Escenario | Resultado Esperado |
| :--- | :--- | :--- |
| **UAT-PMI-01** | Cambio en Ruta Crítica | Desplazamiento automático de sucesoras y actualización de fecha fin del proyecto. |
| **UAT-02** | Integridad de Baseline | Las modificaciones en el plan actual no deben alterar los datos estáticos de la Baseline. |
| **UAT-03** | Sincronización Híbrida | Al marcar "Done" en Kanban, el avance en el Gantt debe reflejar 100% automáticamente. |

---

## 5. Dashboard de KPIs (Métricas de Valor)

### Métricas de Flujo (Agile)
- **Cycle Time:** Tiempo promedio de entrega.
- **Throughput:** Cantidad de ítems terminados por periodo.
- **CFD (Cumulative Flow Diagram):** Estabilidad del proceso.

### Métricas de Gobernanza (PMI/Finanzas)
- **SPI (Schedule Performance Index):** Eficiencia del cronograma (Meta: > 1.0).
- **CPI (Cost Performance Index):** Eficiencia en costos (Meta: > 1.0).
- **Resource Utilization:** Porcentaje de carga de los equipos.

### Métricas de Servicio (ITIL)
- **SLA Compliance Rate:** % de éxito en cumplimiento de tiempos.
- **MTTR (Mean Time to Repair):** Tiempo promedio de resolución de fallos.

---
**Documento finalizado.**
*Este documento constituye la base técnica para el inicio del Sprint 0.*
