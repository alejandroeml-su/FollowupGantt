/**
 * Wave R3.0 Fase 4.2 · Wave P21-C — OData v4 `$metadata` EDMX document.
 *
 * Power BI Desktop SIEMPRE consulta `$metadata` antes de listar los
 * entity sets disponibles en el Navigator dialog. Sin un EDMX válido,
 * Power BI muestra "No items to display".
 *
 * Spec:
 *   - OData v4.01 §11.1.2 (Service Metadata Document)
 *   - http://docs.oasis-open.org/odata/odata/v4.01/odata-v4.01-part1-protocol.html
 *
 * Namespace `Sync` se elige por ser corto y reconocible — Power BI lo
 * muestra como prefijo de los entity types en el Navigator.
 *
 * Power BI types soportados (los que usamos aquí):
 *   - `Edm.String`       → varchar/text/uuid
 *   - `Edm.Int32`        → int
 *   - `Edm.Double`       → float
 *   - `Edm.Decimal`      → numeric(p, s) — incluir `Precision`/`Scale`
 *   - `Edm.DateTimeOffset` → timestamp/datetime con TZ (ISO-8601)
 *   - `Edm.Boolean`      → boolean
 *
 * NavigationProperty: Power BI las muestra como columnas expandibles
 * en el Query Editor. Solo declaramos las que el route soporta en
 * `$expand` (Project→Tasks, Sprint→Project) para no engañar al usuario.
 *
 * Backward-compat: el XML extiende el del PR #192 sin remover entities.
 */

import { ODATA_XML_HEADERS } from '@/lib/api/odata'

export const EDMX_DOC = `<?xml version="1.0" encoding="utf-8"?>
<edmx:Edmx xmlns:edmx="http://docs.oasis-open.org/odata/ns/edmx" Version="4.0">
  <edmx:DataServices>
    <Schema xmlns="http://docs.oasis-open.org/odata/ns/edm" Namespace="Sync">
      <EntityType Name="Project">
        <Key><PropertyRef Name="id" /></Key>
        <Property Name="id" Type="Edm.String" Nullable="false" />
        <Property Name="name" Type="Edm.String" Nullable="false" />
        <Property Name="status" Type="Edm.String" Nullable="false" />
        <Property Name="methodology" Type="Edm.String" Nullable="false" />
        <Property Name="cpi" Type="Edm.Double" />
        <Property Name="spi" Type="Edm.Double" />
        <Property Name="budget" Type="Edm.Decimal" Precision="14" Scale="2" />
        <Property Name="budgetCurrency" Type="Edm.String" />
        <Property Name="managerId" Type="Edm.String" />
        <Property Name="areaId" Type="Edm.String" />
        <Property Name="workspaceId" Type="Edm.String" />
        <Property Name="createdAt" Type="Edm.DateTimeOffset" Nullable="false" />
        <Property Name="updatedAt" Type="Edm.DateTimeOffset" Nullable="false" />
        <NavigationProperty Name="Tasks" Type="Collection(Sync.Task)" />
      </EntityType>
      <EntityType Name="Task">
        <Key><PropertyRef Name="id" /></Key>
        <Property Name="id" Type="Edm.String" Nullable="false" />
        <Property Name="mnemonic" Type="Edm.String" />
        <Property Name="title" Type="Edm.String" Nullable="false" />
        <Property Name="status" Type="Edm.String" Nullable="false" />
        <Property Name="priority" Type="Edm.String" Nullable="false" />
        <Property Name="storyPoints" Type="Edm.Int32" />
        <Property Name="plannedValue" Type="Edm.Double" />
        <Property Name="actualCost" Type="Edm.Double" />
        <Property Name="earnedValue" Type="Edm.Double" />
        <Property Name="progress" Type="Edm.Int32" Nullable="false" />
        <Property Name="projectId" Type="Edm.String" Nullable="false" />
        <Property Name="sprintId" Type="Edm.String" />
        <Property Name="epicId" Type="Edm.String" />
        <Property Name="assigneeId" Type="Edm.String" />
        <Property Name="startDate" Type="Edm.DateTimeOffset" />
        <Property Name="endDate" Type="Edm.DateTimeOffset" />
        <Property Name="createdAt" Type="Edm.DateTimeOffset" Nullable="false" />
        <Property Name="updatedAt" Type="Edm.DateTimeOffset" Nullable="false" />
      </EntityType>
      <EntityType Name="Sprint">
        <Key><PropertyRef Name="id" /></Key>
        <Property Name="id" Type="Edm.String" Nullable="false" />
        <Property Name="name" Type="Edm.String" Nullable="false" />
        <Property Name="goal" Type="Edm.String" />
        <Property Name="status" Type="Edm.String" Nullable="false" />
        <Property Name="startDate" Type="Edm.DateTimeOffset" Nullable="false" />
        <Property Name="endDate" Type="Edm.DateTimeOffset" Nullable="false" />
        <Property Name="capacity" Type="Edm.Int32" />
        <Property Name="velocityActual" Type="Edm.Int32" />
        <Property Name="projectId" Type="Edm.String" Nullable="false" />
        <Property Name="createdAt" Type="Edm.DateTimeOffset" Nullable="false" />
        <Property Name="updatedAt" Type="Edm.DateTimeOffset" Nullable="false" />
        <NavigationProperty Name="Project" Type="Sync.Project" Nullable="false" />
      </EntityType>
      <EntityType Name="Risk">
        <Key><PropertyRef Name="id" /></Key>
        <Property Name="id" Type="Edm.String" Nullable="false" />
        <Property Name="projectId" Type="Edm.String" Nullable="false" />
        <Property Name="title" Type="Edm.String" Nullable="false" />
        <Property Name="probability" Type="Edm.Int32" Nullable="false" />
        <Property Name="impact" Type="Edm.Int32" Nullable="false" />
        <Property Name="score" Type="Edm.Int32" Nullable="false" />
        <Property Name="severity" Type="Edm.String" Nullable="false" />
        <Property Name="status" Type="Edm.String" Nullable="false" />
        <Property Name="ownerId" Type="Edm.String" />
        <Property Name="source" Type="Edm.String" Nullable="false" />
        <Property Name="detectedAt" Type="Edm.DateTimeOffset" />
        <Property Name="closedAt" Type="Edm.DateTimeOffset" />
        <Property Name="createdAt" Type="Edm.DateTimeOffset" Nullable="false" />
        <Property Name="updatedAt" Type="Edm.DateTimeOffset" Nullable="false" />
      </EntityType>
      <EntityType Name="EVMSnapshot">
        <Key><PropertyRef Name="id" /></Key>
        <Property Name="id" Type="Edm.String" Nullable="false" />
        <Property Name="projectId" Type="Edm.String" Nullable="false" />
        <Property Name="snapshotDate" Type="Edm.DateTimeOffset" Nullable="false" />
        <Property Name="plannedValue" Type="Edm.Decimal" Precision="14" Scale="2" Nullable="false" />
        <Property Name="earnedValue" Type="Edm.Decimal" Precision="14" Scale="2" Nullable="false" />
        <Property Name="actualCost" Type="Edm.Decimal" Precision="14" Scale="2" Nullable="false" />
        <Property Name="budgetAtCompletion" Type="Edm.Decimal" Precision="14" Scale="2" />
        <Property Name="cpi" Type="Edm.Double" />
        <Property Name="spi" Type="Edm.Double" />
        <Property Name="estimateAtCompletion" Type="Edm.Decimal" Precision="14" Scale="2" />
        <Property Name="varianceAtCompletion" Type="Edm.Decimal" Precision="14" Scale="2" />
        <Property Name="createdAt" Type="Edm.DateTimeOffset" Nullable="false" />
      </EntityType>
      <EntityType Name="AuditEvent">
        <Key><PropertyRef Name="id" /></Key>
        <Property Name="id" Type="Edm.String" Nullable="false" />
        <Property Name="actorId" Type="Edm.String" />
        <Property Name="action" Type="Edm.String" Nullable="false" />
        <Property Name="entityType" Type="Edm.String" Nullable="false" />
        <Property Name="entityId" Type="Edm.String" />
        <Property Name="ipAddress" Type="Edm.String" />
        <Property Name="userAgent" Type="Edm.String" />
        <Property Name="createdAt" Type="Edm.DateTimeOffset" Nullable="false" />
      </EntityType>
      <EntityContainer Name="Container">
        <EntitySet Name="Projects" EntityType="Sync.Project">
          <NavigationPropertyBinding Path="Tasks" Target="Tasks" />
        </EntitySet>
        <EntitySet Name="Tasks" EntityType="Sync.Task" />
        <EntitySet Name="Sprints" EntityType="Sync.Sprint">
          <NavigationPropertyBinding Path="Project" Target="Projects" />
        </EntitySet>
        <EntitySet Name="Risks" EntityType="Sync.Risk" />
        <EntitySet Name="EVMSnapshots" EntityType="Sync.EVMSnapshot" />
        <EntitySet Name="AuditEvents" EntityType="Sync.AuditEvent" />
      </EntityContainer>
    </Schema>
  </edmx:DataServices>
</edmx:Edmx>
`

export function metadataResponse(): Response {
  return new Response(EDMX_DOC, {
    status: 200,
    headers: ODATA_XML_HEADERS,
  })
}
