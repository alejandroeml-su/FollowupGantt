import { describe, it, expect } from 'vitest'

/**
 * Wave P8 · Equipo P8-5 — Tests del export ICS (RFC 5545).
 *
 * Cubre:
 *   - escapeIcsText escapa los 5 caracteres reservados.
 *   - formatIcsDateTime devuelve YYYYMMDDTHHMMSSZ sin separadores.
 *   - formatIcsDate devuelve YYYYMMDD.
 *   - buildVEvent emite all-day para milestone/deadline (DTSTART;VALUE=DATE).
 *   - buildVEvent emite DATE-TIME para sprint.
 *   - buildIcsBody envuelve VEVENTs con BEGIN/END:VCALENDAR + headers.
 *   - buildIcsBody con array vacío sigue siendo válido.
 *   - generateIcsForToken retorna calendario vacío para token desconocido.
 */

vi.mock('server-only', () => ({}))

import {
  buildIcsBody,
  buildVEvent,
  escapeIcsText,
  formatIcsDate,
  formatIcsDateTime,
  generateIcsForToken,
} from '@/lib/calendar/ics-export'
import { vi } from 'vitest'

describe('escapeIcsText', () => {
  it('1. escapa coma, semicolon, backslash y newline', () => {
    expect(escapeIcsText('a,b;c\\d\ne')).toBe('a\\,b\\;c\\\\d\\ne')
  })

  it('2. preserva caracteres normales', () => {
    expect(escapeIcsText('Hola Mundo 123')).toBe('Hola Mundo 123')
  })
})

describe('formatIcsDateTime', () => {
  it('3. emite YYYYMMDDTHHMMSSZ sin guiones ni dos puntos', () => {
    const d = new Date('2026-05-04T12:30:45.000Z')
    expect(formatIcsDateTime(d)).toBe('20260504T123045Z')
  })

  it('4. funciona con segundos exactos sin milisegundos', () => {
    const d = new Date('2030-01-01T00:00:00.000Z')
    expect(formatIcsDateTime(d)).toBe('20300101T000000Z')
  })
})

describe('formatIcsDate', () => {
  it('5. emite YYYYMMDD sin guiones', () => {
    const d = new Date('2026-05-04T12:00:00.000Z')
    expect(formatIcsDate(d)).toBe('20260504')
  })
})

describe('buildVEvent', () => {
  it('6. milestone se emite como DATE all-day con DTEND exclusivo +1 día', () => {
    const out = buildVEvent(
      {
        taskId: 't1',
        type: 'milestone',
        title: 'Hito demo',
        startsAt: new Date('2026-05-10T00:00:00.000Z'),
        endsAt: new Date('2026-05-10T00:00:00.000Z'),
      },
      { uid: 'uid-1', dtstamp: new Date('2026-05-04T00:00:00.000Z') },
    )
    expect(out).toContain('DTSTART;VALUE=DATE:20260510')
    // Fecha exclusiva → +1 día
    expect(out).toContain('DTEND;VALUE=DATE:20260511')
    expect(out).toContain('SUMMARY:Hito demo')
    expect(out).toMatch(/^BEGIN:VEVENT/)
    expect(out).toMatch(/END:VEVENT$/)
  })

  it('7. sprint se emite como DATE-TIME (con horas)', () => {
    const out = buildVEvent(
      {
        taskId: 's1',
        type: 'sprint',
        title: 'Sprint X',
        startsAt: new Date('2026-05-01T09:00:00.000Z'),
        endsAt: new Date('2026-05-14T18:00:00.000Z'),
      },
      { uid: 'uid-2', dtstamp: new Date('2026-05-04T00:00:00.000Z') },
    )
    expect(out).toContain('DTSTART:20260501T090000Z')
    expect(out).toContain('DTEND:20260514T180000Z')
    expect(out).not.toContain('VALUE=DATE')
  })

  it('8. escapa el título (coma + semicolon)', () => {
    const out = buildVEvent(
      {
        taskId: 't1',
        type: 'milestone',
        title: 'Hito; con, coma',
        startsAt: new Date('2026-05-10'),
        endsAt: new Date('2026-05-10'),
      },
      { uid: 'uid-3', dtstamp: new Date('2026-05-04') },
    )
    expect(out).toContain('Hito\\; con\\, coma')
  })
})

describe('buildIcsBody', () => {
  it('9. envuelve VEVENTs con headers VCALENDAR válidos', () => {
    const result = buildIcsBody(
      [
        {
          taskId: 't1',
          type: 'milestone',
          title: 'M',
          startsAt: new Date('2026-05-10'),
          endsAt: new Date('2026-05-10'),
        },
      ],
      {
        feedToken: 'tok',
        dtstamp: new Date('2026-05-04T00:00:00.000Z'),
      },
    )
    expect(result.eventCount).toBe(1)
    expect(result.body).toContain('BEGIN:VCALENDAR')
    expect(result.body).toContain('END:VCALENDAR')
    expect(result.body).toContain('VERSION:2.0')
    expect(result.body).toContain('PRODID:-//FollowupGantt')
    expect(result.body).toContain('BEGIN:VEVENT')
    expect(result.body).toContain('END:VEVENT')
  })

  it('10. usa CRLF como separador (RFC 5545)', () => {
    const result = buildIcsBody([], {
      feedToken: 'tok',
      dtstamp: new Date('2026-05-04'),
    })
    expect(result.body).toContain('\r\n')
  })

  it('11. con array vacío sigue siendo VCALENDAR válido (header+footer)', () => {
    const result = buildIcsBody([], {
      feedToken: 'tok-empty',
      dtstamp: new Date('2026-05-04'),
    })
    expect(result.eventCount).toBe(0)
    expect(result.body).toContain('BEGIN:VCALENDAR')
    expect(result.body).toContain('END:VCALENDAR')
    expect(result.body).not.toContain('BEGIN:VEVENT')
  })

  it('12. UID incluye token + taskId + type para idempotencia', () => {
    const result = buildIcsBody(
      [
        {
          taskId: 'task-abc',
          type: 'deadline',
          title: 'D',
          startsAt: new Date('2026-05-10'),
          endsAt: new Date('2026-05-10'),
        },
      ],
      {
        feedToken: 'feedtok',
        dtstamp: new Date('2026-05-04'),
      },
    )
    expect(result.body).toContain('UID:feedtok-task-abc-deadline')
  })

  it('13. plega líneas largas a 75 chars con CRLF + space', () => {
    const longTitle = 'A'.repeat(120)
    const result = buildIcsBody(
      [
        {
          taskId: 'tlong',
          type: 'milestone',
          title: longTitle,
          startsAt: new Date('2026-05-10'),
          endsAt: new Date('2026-05-10'),
        },
      ],
      {
        feedToken: 'tok',
        dtstamp: new Date('2026-05-04'),
      },
    )
    // El folding inserta CRLF + space en líneas >75 chars
    expect(result.body).toMatch(/\r\n /)
  })
})

describe('generateIcsForToken', () => {
  it('14. token desconocido → calendario vacío válido', async () => {
    const fakePrisma = {
      calendarConnection: {
        findUnique: vi.fn().mockResolvedValue(null),
      },
      userRole: { findMany: vi.fn().mockResolvedValue([]) },
      projectAssignment: { findMany: vi.fn().mockResolvedValue([]) },
      task: { findMany: vi.fn() },
      sprint: { findMany: vi.fn() },
    }
    const out = await generateIcsForToken('tok-bad', {
      prismaClient: fakePrisma as unknown as never,
      now: () => new Date('2026-05-04'),
    })
    expect(out.eventCount).toBe(0)
    expect(out.body).toContain('BEGIN:VCALENDAR')
  })

  it('15. syncEnabled=false → calendario vacío sin tocar tasks', async () => {
    const taskFindMany = vi.fn().mockResolvedValue([])
    const fakePrisma = {
      calendarConnection: {
        findUnique: vi.fn().mockResolvedValue({
          id: 'c1',
          userId: 'u1',
          syncEnabled: false,
          syncMilestones: true,
          syncDeadlines: true,
          syncSprints: false,
        }),
      },
      userRole: { findMany: vi.fn().mockResolvedValue([]) },
      projectAssignment: { findMany: vi.fn().mockResolvedValue([]) },
      task: { findMany: taskFindMany },
      sprint: { findMany: vi.fn() },
    }
    const out = await generateIcsForToken('tok-disabled', {
      prismaClient: fakePrisma as unknown as never,
      now: () => new Date('2026-05-04'),
    })
    expect(out.eventCount).toBe(0)
    // No debió consultar tasks: la conexión está deshabilitada.
    expect(taskFindMany).not.toHaveBeenCalled()
  })
})
