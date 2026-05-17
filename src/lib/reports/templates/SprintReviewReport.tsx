/**
 * Wave R5 Extended · US-Reporting-PDF — Template `SprintReviewReport`.
 *
 * Server-only React tree para `@react-pdf/renderer`. Renderiza:
 *   - Header con sprint name + objetivo.
 *   - Fechas + velocity (story points completados vs planificados).
 *   - Tabla de historias completadas vs planificadas.
 *   - Retrospective takeaways si existe Retro asociada al sprint.
 */

import 'server-only'
import { Document, Page, Text, View, StyleSheet } from '@react-pdf/renderer'
import * as React from 'react'

// ───────────────────────── Shape de datos ─────────────────────────

export interface SprintReviewReportData {
  project: { id: string; name: string }
  sprint: {
    id: string
    name: string
    goal: string | null
    startDate: string
    endDate: string
    status: string
  }
  velocity: {
    plannedSp: number
    completedSp: number
    plannedStories: number
    completedStories: number
  }
  stories: Array<{
    title: string
    status: string
    storyPoints: number | null
    assignee: string | null
  }>
  retro: {
    title: string
    notes: string | null
    completedAt: string | null
    facilitator: string | null
    takeaways: Array<{ category: string; text: string }>
  } | null
  generatedAt: string
}

// ───────────────────────── Estilos ─────────────────────────

const styles = StyleSheet.create({
  page: {
    paddingTop: 40,
    paddingBottom: 50,
    paddingHorizontal: 36,
    fontSize: 10,
    fontFamily: 'Helvetica',
    color: '#1f2937',
  },
  header: {
    borderBottomWidth: 1,
    borderBottomColor: '#16a34a',
    paddingBottom: 6,
    marginBottom: 14,
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'flex-end',
  },
  brand: {
    fontSize: 18,
    fontWeight: 700,
    color: '#16a34a',
    letterSpacing: 1,
  },
  brandTag: { fontSize: 9, color: '#6b7280' },
  title: {
    fontSize: 16,
    fontWeight: 700,
    marginBottom: 2,
    color: '#111827',
  },
  subtitle: { fontSize: 10, color: '#6b7280', marginBottom: 10 },
  sectionTitle: {
    fontSize: 11,
    fontWeight: 700,
    marginTop: 10,
    marginBottom: 4,
    color: '#16a34a',
    textTransform: 'uppercase',
    letterSpacing: 0.5,
  },
  goalBox: {
    marginVertical: 6,
    padding: 8,
    backgroundColor: '#f0fdf4',
    borderLeftWidth: 3,
    borderLeftColor: '#16a34a',
    borderRadius: 2,
  },
  goalLabel: { fontSize: 8, color: '#15803d', textTransform: 'uppercase' },
  goalText: { fontSize: 10, color: '#14532d', marginTop: 2 },
  metaGrid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 6,
    marginBottom: 8,
  },
  metaCell: {
    width: '23%',
    padding: 6,
    backgroundColor: '#f3f4f6',
    borderRadius: 3,
  },
  metaLabel: { fontSize: 8, color: '#6b7280', textTransform: 'uppercase' },
  metaValue: {
    fontSize: 11,
    fontWeight: 700,
    color: '#111827',
    marginTop: 2,
  },
  table: { marginTop: 4 },
  tableHeaderRow: {
    flexDirection: 'row',
    borderBottomWidth: 1,
    borderBottomColor: '#9ca3af',
    paddingVertical: 4,
    backgroundColor: '#f9fafb',
  },
  tableRow: {
    flexDirection: 'row',
    borderBottomWidth: 0.5,
    borderBottomColor: '#e5e7eb',
    paddingVertical: 4,
  },
  cellTitle: { flexBasis: '50%' },
  cellAssignee: { flexBasis: '25%' },
  cellStatus: { flexBasis: '15%' },
  cellSp: { flexBasis: '10%', textAlign: 'right' },
  headerCell: { fontWeight: 700, fontSize: 9, color: '#374151' },
  bodyCell: { fontSize: 9, color: '#1f2937' },
  retroItem: {
    flexDirection: 'row',
    marginBottom: 4,
    gap: 4,
  },
  retroCategory: {
    fontSize: 8,
    color: '#15803d',
    fontWeight: 700,
    width: 80,
    textTransform: 'uppercase',
  },
  retroText: { fontSize: 9, color: '#1f2937', flexGrow: 1 },
  empty: { fontSize: 9, color: '#9ca3af', fontStyle: 'italic' },
  footer: {
    position: 'absolute',
    bottom: 24,
    left: 36,
    right: 36,
    borderTopWidth: 0.5,
    borderTopColor: '#d1d5db',
    paddingTop: 6,
    fontSize: 8,
    color: '#6b7280',
    flexDirection: 'row',
    justifyContent: 'space-between',
  },
})

// ───────────────────────── Helpers ─────────────────────────

function formatDate(iso: string | null): string {
  if (!iso) return '—'
  const d = new Date(iso)
  if (Number.isNaN(d.getTime())) return '—'
  return d.toISOString().slice(0, 10)
}

function formatGeneratedAt(iso: string): string {
  const d = new Date(iso)
  if (Number.isNaN(d.getTime())) return iso
  return `${d.toISOString().slice(0, 10)} ${d.toISOString().slice(11, 16)} UTC`
}

// ───────────────────────── Template ─────────────────────────

export function SprintReviewReport({
  data,
}: {
  data: SprintReviewReportData
}) {
  return (
    <Document
      title={`Sprint Review — ${data.sprint.name}`}
      author="Sync · Inversiones Avante"
    >
      <Page size="A4" style={styles.page}>
        <View style={styles.header} fixed>
          <View>
            <Text style={styles.brand}>Sync</Text>
            <Text style={styles.brandTag}>Sprint Review</Text>
          </View>
          <View>
            <Text style={styles.brandTag}>Inversiones Avante</Text>
            <Text style={styles.brandTag}>
              Unidad de Transformación Digital
            </Text>
          </View>
        </View>

        <Text style={styles.title}>{data.sprint.name}</Text>
        <Text style={styles.subtitle}>
          Proyecto: {data.project.name} · Estado: {data.sprint.status}
        </Text>

        <View style={styles.goalBox}>
          <Text style={styles.goalLabel}>Sprint Goal</Text>
          <Text style={styles.goalText}>
            {data.sprint.goal ?? 'Sin Sprint Goal documentado.'}
          </Text>
        </View>

        <Text style={styles.sectionTitle}>Métricas</Text>
        <View style={styles.metaGrid}>
          <View style={styles.metaCell}>
            <Text style={styles.metaLabel}>Inicio</Text>
            <Text style={styles.metaValue}>
              {formatDate(data.sprint.startDate)}
            </Text>
          </View>
          <View style={styles.metaCell}>
            <Text style={styles.metaLabel}>Fin</Text>
            <Text style={styles.metaValue}>
              {formatDate(data.sprint.endDate)}
            </Text>
          </View>
          <View style={styles.metaCell}>
            <Text style={styles.metaLabel}>SP completados</Text>
            <Text style={styles.metaValue}>
              {data.velocity.completedSp} / {data.velocity.plannedSp}
            </Text>
          </View>
          <View style={styles.metaCell}>
            <Text style={styles.metaLabel}>Stories cerradas</Text>
            <Text style={styles.metaValue}>
              {data.velocity.completedStories} /{' '}
              {data.velocity.plannedStories}
            </Text>
          </View>
        </View>

        <Text style={styles.sectionTitle}>Historias del sprint</Text>
        {data.stories.length === 0 ? (
          <Text style={styles.empty}>Sprint sin historias asignadas.</Text>
        ) : (
          <View style={styles.table}>
            <View style={styles.tableHeaderRow}>
              <Text style={[styles.headerCell, styles.cellTitle]}>
                Historia
              </Text>
              <Text style={[styles.headerCell, styles.cellAssignee]}>
                Asignado
              </Text>
              <Text style={[styles.headerCell, styles.cellStatus]}>
                Estado
              </Text>
              <Text style={[styles.headerCell, styles.cellSp]}>SP</Text>
            </View>
            {data.stories.map((s, i) => (
              <View key={i} style={styles.tableRow} wrap={false}>
                <Text style={[styles.bodyCell, styles.cellTitle]}>
                  {s.title}
                </Text>
                <Text style={[styles.bodyCell, styles.cellAssignee]}>
                  {s.assignee ?? '—'}
                </Text>
                <Text style={[styles.bodyCell, styles.cellStatus]}>
                  {s.status}
                </Text>
                <Text style={[styles.bodyCell, styles.cellSp]}>
                  {s.storyPoints ?? '—'}
                </Text>
              </View>
            ))}
          </View>
        )}

        <Text style={styles.sectionTitle}>Retrospectiva</Text>
        {data.retro ? (
          <View>
            <Text style={styles.bodyCell}>
              {data.retro.title}
              {data.retro.facilitator
                ? ` · Facilitador: ${data.retro.facilitator}`
                : ''}
              {data.retro.completedAt
                ? ` · Cerrada ${formatDate(data.retro.completedAt)}`
                : ' · En curso'}
            </Text>
            {data.retro.notes ? (
              <Text style={[styles.bodyCell, { marginTop: 4 }]}>
                {data.retro.notes}
              </Text>
            ) : null}
            {data.retro.takeaways.length > 0 ? (
              <View style={{ marginTop: 6 }}>
                {data.retro.takeaways.map((t, i) => (
                  <View key={i} style={styles.retroItem} wrap={false}>
                    <Text style={styles.retroCategory}>{t.category}</Text>
                    <Text style={styles.retroText}>{t.text}</Text>
                  </View>
                ))}
              </View>
            ) : (
              <Text style={[styles.empty, { marginTop: 4 }]}>
                Retro creada pero sin items capturados.
              </Text>
            )}
          </View>
        ) : (
          <Text style={styles.empty}>
            No hay retrospectiva registrada para este sprint.
          </Text>
        )}

        <View style={styles.footer} fixed>
          <Text>
            Inversiones Avante · Unidad de Transformación Digital · Generado{' '}
            {formatGeneratedAt(data.generatedAt)}
          </Text>
          <Text
            render={({ pageNumber, totalPages }) =>
              `${pageNumber}/${totalPages}`
            }
          />
        </View>
      </Page>
    </Document>
  )
}
