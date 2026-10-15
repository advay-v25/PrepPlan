import { parseWeekday } from '../planning/weekday'

type TimeSlot = {
  weekday: number
  startTime: string
  endTime: string
}

export function calculateAvailableWindows(
  commitments: TimeSlot[],
  wakingHourStart = '07:00',
  wakingHourEnd = '22:00'
): TimeSlot[] {
  // A naive deriver just to show how one might auto-suggest windows
  // For canonical onboarding, we mostly rely on explicit user input,
  // but this can pre-fill empty days.
  const windows: TimeSlot[] = []

  for (let day = 0; day < 7; day++) {
    const dayComms = commitments
      .filter(c => c.weekday === day)
      .sort((a, b) => a.startTime.localeCompare(b.startTime))

    let current = wakingHourStart

    for (const c of dayComms) {
      if (current < c.startTime) {
        windows.push({ weekday: day, startTime: current, endTime: c.startTime })
      }
      if (current < c.endTime) {
        current = c.endTime
      }
    }

    if (current < wakingHourEnd) {
      windows.push({ weekday: day, startTime: current, endTime: wakingHourEnd })
    }
  }

  return windows
}
