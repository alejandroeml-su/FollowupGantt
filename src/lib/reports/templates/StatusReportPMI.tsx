/**
 * Wave R5 Extended · US-Reporting-PDF — Template `StatusReportPMI`.
 *
 * Server-only React tree consumido por `@react-pdf/renderer`. NO usar
 * `"use client"` ni primitivas DOM — sólo los componentes que exporta
 * `@react-pdf/renderer` (Document, Page, View, Text, StyleSheet).
 *
 * Branding "Sync" como header de texto plano (sin SVG embed por scope).
 * Footer pie con sello "Inversiones Avante · Unidad de Transformación
 * Digital · Generado YYYY-MM-DD HH:mm".
 */

import 'server-only'
import { Document, Page, Text, View, StyleSheet } from '@react-pdf/renderer'
import * as React from 'react'

// ───────────────────────── Shape de datos ─────────────────────────

export interface StatusReportPMIData {
  project: {
    id: string
    name: string
    status: string
    progress: number
    plannedStart: string | null
    plannedEnd: string | null
    actualStart: string | null
    actualEnd: string | null
  }
  evm: {
    pv: number
    ev: number
    ac: number
    spi: number | null
    cpi: number | null
  } | null
  topRisks: Array<{
    title: string
    severity: 'CRITICAL' | 'HIGH' | 'MEDIUM' | 'LOW'
    status: string
  }>
  upcomingMilestones: Array<{
    title: string
    endDate: string | null
  }>
  scheduleDeviation: Array<{
    title: string
    endDate: string | null
    daysLate: number
  }>
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
    borderBottomColor: '#4f46e5',
    paddingBottom: 6,
    marginBottom: 14,
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'flex-end',
  },
  brand: {
    fontSize: 18,
    fontWeight: 700,
    color: '#4f46e5',
    letterSpacing: 1,
  },
  brandTag: {
    fontSize: 9,
    color: '#6b7280',
  },
  title: {
    fontSize: 16,
    fontWeight: 700,
    marginBottom: 4,
    color: '#111827',
  },
  subtitle: {
    fontSize: 10,
    color: '#6b7280',
    marginBottom: 12,
  },
  sectionTitle: {
    fontSize: 11,
    fontWeight: 700,
    marginTop: 10,
    marginBottom: 4,
    color: '#4f46e5',
    textTransform: 'uppercase',
    letterSpacing: 0.5,
  },
  metaGrid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 6,
    marginBottom: 8,
  },
  metaCell: {
    width: '48%',
    padding: 6,
    backgroundColor: '#f3f4f6',
    borderRadius: 3,
  },
  metaLabel: {
    fontSize: 8,
    color: '#6b7280',
    textTransform: 'uppercase',
  },
  metaValue: {
    fontSize: 11,
    fontWeight: 700,
    color: '#111827',
    marginTop: 2,
  },
  evmRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    marginTop: 4,
  },
  evmCell: {
    flexBasis: '18%',
    padding: 6,
    backgroundColor: '#eef2ff',
    borderRadius: 3,
    alignItems: 'center',
  },
  table: {
    marginTop: 4,
  },
  tableRow: {
    flexDirection: 'row',
    borderBottomWidth: 0.5,
    borderBottomColor: '#e5e7eb',
    paddingVertical: 4,
  },
  tableHeaderRow: {
    flexDirection: 'row',
    borderBottomWidth: 1,
    borderBottomColor: '#9ca3af',
    paddingVertical: 4,
    backgroundColor: '#f9fafb',
  },
  tableCellTitle: { flexGrow: 1, flexBasis: '60%' },
  tableCellMid: { flexBasis: '20%' },
  tableCellSmall: { flexBasis: '20%', textAlign: 'right' },
  headerCell: { fontWeight: 700, fontSize: 9, color: '#374151' },
  bodyCell: { fontSize: 9, color: '#1f2937' },
  empty: {
    fontSize: 9,
    color: '#9ca3af',
    fontStyle: 'italic',
  },
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

// ───────────────────────── Utilidades de formato ─────────────────────────

function formatDate(iso: string | null): string {
  if (!iso) return '—'
  const d = new Date(iso)
  if (Number.isNaN(d.getTime())) return '—'
  return d.toISOString().slice(0, 10)
}

function formatGeneratedAt(iso: string): string {
  const d = new Date(iso)
  if (Number.isNaN(d.getTime())) return iso
  // YYYY-MM-DD HH:mm en UTC para evitar TZ ambiguo en server.
  return `${d.toISOString().slice(0, 10)} ${d.toISOString().slice(11, 16)} UTC`
}

function formatNumber(value: number | null | undefined, digits = 2): string {
  if (value === null || value === undefined || Number.isNaN(value)) return '—'
  return value.toFixed(digits)
}

function formatCurrency(value: number | null | undefined): string {
  if (value === null || value === undefined || Number.isNaN(value)) return '—'
  return `$${value.toLocaleString('en-US', { maximumFractionDigits: 0 })}`
}

// ───────────────────────── Template ─────────────────────────

export function StatusReportPMI({ data }: { data: StatusReportPMIData }) {
  return (
    <Document
      title={`Status Report PMI — ${data.project.name}`}
      author="Sync · Inversiones Avante"
    >
      <Page size="A4" style={styles.page}>
        {/* Header de branding */}
        <View style={styles.header} fixed>
          <View>
            <Text style={styles.brand}>Sync</Text>
            <Text style={styles.brandTag}>Status Report PMI</Text>
          </View>
          <View>
            <Text style={styles.brandTag}>Inversiones Avante</Text>
            <Text style={styles.brandTag}>
              Unidad de Transformación Digital
            </Text>
          </View>
        </View>

        <Text style={styles.title}>{data.project.name}</Text>
        <Text style={styles.subtitle}>
          Status: {data.project.status} · Progreso: {data.project.progress}%
        </Text>

        {/* Metadatos ejecutivos */}
        <Text style={styles.sectionTitle}>Cronograma</Text>
        <View style={styles.metaGrid}>
          <View style={styles.metaCell}>
            <Text style={styles.metaLabel}>Inicio planificado</Text>
            <Text style={styles.metaValue}>
              {formatDate(data.project.plannedStart)}
            </Text>
          </View>
          <View style={styles.metaCell}>
            <Text style={styles.metaLabel}>Fin planificado</Text>
            <Text style={styles.metaValue}>
              {formatDate(data.project.plannedEnd)}
            </Text>
          </View>
          <View style={styles.metaCell}>
            <Text style={styles.metaLabel}>Inicio real</Text>
            <Text style={styles.metaValue}>
              {formatDate(data.project.actualStart)}
            </Text>
          </View>
          <View style={styles.metaCell}>
            <Text style={styles.metaLabel}>Fin real (proyectado)</Text>
            <Text style={styles.metaValue}>
              {formatDate(data.project.actualEnd)}
            </Text>
          </View>
        </View>

        {/* EVM */}
        <Text style={styles.sectionTitle}>EVM (último snapshot)</Text>
        {data.evm ? (
          <View style={styles.evmRow}>
            <View style={styles.evmCell}>
              <Text style={styles.metaLabel}>PV</Text>
              <Text style={styles.metaValue}>{formatCurrency(data.evm.pv)}</Text>
            </View>
            <View style={styles.evmCell}>
              <Text style={styles.metaLabel}>EV</Text>
              <Text style={styles.metaValue}>{formatCurrency(data.evm.ev)}</Text>
            </View>
            <View style={styles.evmCell}>
              <Text style={styles.metaLabel}>AC</Text>
              <Text style={styles.metaValue}>{formatCurrency(data.evm.ac)}</Text>
            </View>
            <View style={styles.evmCell}>
              <Text style={styles.metaLabel}>SPI</Text>
              <Text style={styles.metaValue}>{formatNumber(data.evm.spi)}</Text>
            </View>
            <View style={styles.evmCell}>
              <Text style={styles.metaLabel}>CPI</Text>
              <Text style={styles.metaValue}>{formatNumber(data.evm.cpi)}</Text>
            </View>
          </View>
        ) : (
          <Text style={styles.empty}>N/A · sin EVM Snapshot capturado.</Text>
        )}

        {/* Riesgos abiertos top 5 */}
        <Text style={styles.sectionTitle}>Riesgos abiertos · Top 5</Text>
        {data.topRisks.length === 0 ? (
          <Text style={styles.empty}>Sin riesgos abiertos registrados.</Text>
        ) : (
          <View style={styles.table}>
            <View style={styles.tableHeaderRow}>
              <Text style={[styles.headerCell, styles.tableCellTitle]}>
                Riesgo
              </Text>
              <Text style={[styles.headerCell, styles.tableCellMid]}>
                Severidad
              </Text>
              <Text style={[styles.headerCell, styles.tableCellSmall]}>
                Estado
              </Text>
            </View>
            {data.topRisks.map((r, i) => (
              <View key={i} style={styles.tableRow} wrap={false}>
                <Text style={[styles.bodyCell, styles.tableCellTitle]}>
                  {r.title}
                </Text>
                <Text style={[styles.bodyCell, styles.tableCellMid]}>
                  {r.severity}
                </Text>
                <Text style={[styles.bodyCell, styles.tableCellSmall]}>
                  {r.status}
                </Text>
              </View>
            ))}
          </View>
        )}

        {/* Próximos hitos */}
        <Text style={styles.sectionTitle}>Próximos hitos · Top 5</Text>
        {data.upcomingMilestones.length === 0 ? (
          <Text style={styles.empty}>Sin hitos pendientes próximos.</Text>
        ) : (
          <View style={styles.table}>
            <View style={styles.tableHeaderRow}>
              <Text style={[styles.headerCell, styles.tableCellTitle]}>
                Hito
              </Text>
              <Text style={[styles.headerCell, styles.tableCellSmall]}>
                Fecha
              </Text>
            </View>
            {data.upcomingMilestones.map((m, i) => (
              <View key={i} style={styles.tableRow} wrap={false}>
                <Text style={[styles.bodyCell, styles.tableCellTitle]}>
                  {m.title}
                </Text>
                <Text style={[styles.bodyCell, styles.tableCellSmall]}>
                  {formatDate(m.endDate)}
                </Text>
              </View>
            ))}
          </View>
        )}

        {/* Tareas atrasadas */}
        <Text style={styles.sectionTitle}>
          Desviaciones de cronograma (tareas con retraso)
        </Text>
        {data.scheduleDeviation.length === 0 ? (
          <Text style={styles.empty}>
            Sin tareas con retraso significativo detectado.
          </Text>
        ) : (
          <View style={styles.table}>
            <View style={styles.tableHeaderRow}>
              <Text style={[styles.headerCell, styles.tableCellTitle]}>
                Tarea
              </Text>
              <Text style={[styles.headerCell, styles.tableCellMid]}>
                Fin planificado
              </Text>
              <Text style={[styles.headerCell, styles.tableCellSmall]}>
                Días tarde
              </Text>
            </View>
            {data.scheduleDeviation.map((t, i) => (
              <View key={i} style={styles.tableRow} wrap={false}>
                <Text style={[styles.bodyCell, styles.tableCellTitle]}>
                  {t.title}
                </Text>
                <Text style={[styles.bodyCell, styles.tableCellMid]}>
                  {formatDate(t.endDate)}
                </Text>
                <Text style={[styles.bodyCell, styles.tableCellSmall]}>
                  {t.daysLate}
                </Text>
              </View>
            ))}
          </View>
        )}

        {/* Footer institucional */}
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
