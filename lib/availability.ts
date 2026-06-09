interface DaySchedule {
  enabled: boolean
  start: string // "09:00"
  end: string   // "18:00"
}

export interface Availability {
  timezone: string
  days: Record<string, DaySchedule>
  slotDurationMin: number
  bufferBetweenMin: number
  lunchBreak: { enabled: boolean; start: string; end: string }
}

// Default if not configured
export const DEFAULT_AVAILABILITY: Availability = {
  timezone: 'Europe/Paris',
  days: {
    lundi:    { enabled: true,  start: '09:00', end: '18:00' },
    mardi:    { enabled: true,  start: '09:00', end: '18:00' },
    mercredi: { enabled: true,  start: '09:00', end: '18:00' },
    jeudi:    { enabled: true,  start: '09:00', end: '18:00' },
    vendredi: { enabled: true,  start: '09:00', end: '17:00' },
    samedi:   { enabled: false, start: '09:00', end: '12:00' },
    dimanche: { enabled: false, start: '09:00', end: '12:00' },
  },
  slotDurationMin: 30,
  bufferBetweenMin: 15,
  lunchBreak: { enabled: true, start: '12:00', end: '14:00' },
}

// Map JS getDay() (0=Sunday) to French day keys
const JS_DAY_TO_FR: Record<number, string> = {
  0: 'dimanche',
  1: 'lundi',
  2: 'mardi',
  3: 'mercredi',
  4: 'jeudi',
  5: 'vendredi',
  6: 'samedi',
}

function parseTime(timeStr: string): { h: number; m: number } {
  const [h, m] = timeStr.split(':').map(Number)
  return { h, m }
}

function timeToMinutes(timeStr: string): number {
  const { h, m } = parseTime(timeStr)
  return h * 60 + m
}

function minutesOfDay(date: Date): number {
  return date.getHours() * 60 + date.getMinutes()
}

export async function getAvailability(): Promise<Availability> {
  try {
    if (!process.env.DATABASE_URL) return DEFAULT_AVAILABILITY

    const { db } = await import('@/lib/db')
    const { agent_config } = await import('@/lib/db/schema')
    const { eq } = await import('drizzle-orm')

    const [row] = await db
      .select({ value: agent_config.value })
      .from(agent_config)
      .where(eq(agent_config.key, 'availability'))
      .limit(1)

    if (!row?.value) return DEFAULT_AVAILABILITY

    const parsed = JSON.parse(row.value) as Availability
    // Merge with defaults to handle partial configs
    return {
      ...DEFAULT_AVAILABILITY,
      ...parsed,
      days: { ...DEFAULT_AVAILABILITY.days, ...parsed.days },
      lunchBreak: { ...DEFAULT_AVAILABILITY.lunchBreak, ...parsed.lunchBreak },
    }
  } catch {
    return DEFAULT_AVAILABILITY
  }
}

export function isSlotAvailable(date: Date, availability: Availability): boolean {
  const dayKey = JS_DAY_TO_FR[date.getDay()]
  const daySchedule = availability.days[dayKey]

  if (!daySchedule?.enabled) return false

  const slotMin = minutesOfDay(date)
  const startMin = timeToMinutes(daySchedule.start)
  const endMin = timeToMinutes(daySchedule.end)

  if (slotMin < startMin || slotMin >= endMin) return false

  // Check lunch break
  if (availability.lunchBreak.enabled) {
    const lunchStart = timeToMinutes(availability.lunchBreak.start)
    const lunchEnd = timeToMinutes(availability.lunchBreak.end)
    if (slotMin >= lunchStart && slotMin < lunchEnd) return false
  }

  return true
}

export function findNextAvailableSlot(
  preferredDate: Date | null,
  availability: Availability
): Date {
  const candidate = preferredDate ? new Date(preferredDate) : (() => {
    // Start from next working day at 10:00
    const d = new Date()
    d.setDate(d.getDate() + 1)
    d.setHours(10, 0, 0, 0)
    return d
  })()

  // Zero out seconds/ms
  candidate.setSeconds(0, 0)

  // Round up to nearest slot boundary
  const slotMin = availability.slotDurationMin || 30
  const totalMin = candidate.getHours() * 60 + candidate.getMinutes()
  const rounded = Math.ceil(totalMin / slotMin) * slotMin
  candidate.setHours(Math.floor(rounded / 60), rounded % 60, 0, 0)

  // Try up to 14 days forward
  for (let dayOffset = 0; dayOffset < 14; dayOffset++) {
    const dayKey = JS_DAY_TO_FR[candidate.getDay()]
    const daySchedule = availability.days[dayKey]

    if (daySchedule?.enabled) {
      const startMin = timeToMinutes(daySchedule.start)
      const endMin = timeToMinutes(daySchedule.end)

      // If we're before start, jump to start
      if (minutesOfDay(candidate) < startMin) {
        candidate.setHours(Math.floor(startMin / 60), startMin % 60, 0, 0)
      }

      // Walk through slots in this day
      while (minutesOfDay(candidate) < endMin) {
        if (isSlotAvailable(candidate, availability)) {
          return candidate
        }
        candidate.setMinutes(candidate.getMinutes() + slotMin)
      }
    }

    // Move to next day at start of that day's schedule
    candidate.setDate(candidate.getDate() + 1)
    candidate.setHours(9, 0, 0, 0)
  }

  // Fallback: next weekday at 10:00
  const fallback = new Date()
  fallback.setDate(fallback.getDate() + 1)
  fallback.setHours(10, 0, 0, 0)
  return fallback
}
