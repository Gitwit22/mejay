import {useState} from 'react'
import {addDays, format, isBefore, parse, startOfDay} from 'date-fns'
import {CalendarDays, Clock} from 'lucide-react'

import {Button} from '@/components/ui/button'
import {Calendar} from '@/components/ui/calendar'
import {Popover, PopoverContent, PopoverTrigger} from '@/components/ui/popover'
import {cn} from '@/lib/utils'
import {MIN_RELEASE_LEAD_DAYS} from '@/lib/releaseTime'

/** Every half hour of the day, as "HH:mm". */
const TIME_SLOTS = Array.from({length: 48}, (_, index) => `${String(Math.floor(index / 2)).padStart(2, '0')}:${index % 2 ? '30' : '00'}`)
const QUICK_TIMES: Array<{label: string; value: string}> = [
  {label: '12 AM', value: '00:00'},
  {label: '9 AM', value: '09:00'},
  {label: 'Noon', value: '12:00'},
  {label: '6 PM', value: '18:00'},
]
const DEFAULT_TIME = '00:00'

function timeLabel(value: string): string {
  return format(parse(value, 'HH:mm', new Date(2000, 0, 1)), 'h:mm a')
}

function splitLocal(local: string): {day: Date | undefined; time: string | null} {
  const match = /^(\d{4}-\d{2}-\d{2})T(\d{2}:\d{2})$/.exec(local)
  if (!match) return {day: undefined, time: null}
  return {day: parse(match[1], 'yyyy-MM-dd', new Date()), time: match[2]}
}

/**
 * Calendar + time picker for a release's wall-clock date and time ("YYYY-MM-DDTHH:mm"). The
 * timezone is chosen separately. Days less than 7 days out are greyed out to steer artists toward
 * a date that will pass the submission rule (the server still enforces it).
 */
export function ReleaseDateTimePicker({value, onChange, invalid = false, now = new Date()}: {
  value: string
  onChange: (local: string) => void
  invalid?: boolean
  now?: Date
}) {
  const [dateOpen, setDateOpen] = useState(false)
  const [timeOpen, setTimeOpen] = useState(false)
  const {day, time} = splitLocal(value)
  const earliest = startOfDay(addDays(now, MIN_RELEASE_LEAD_DAYS))
  const set = (nextDay: Date | undefined, nextTime: string | null) => {
    if (!nextDay) return
    onChange(`${format(nextDay, 'yyyy-MM-dd')}T${nextTime ?? DEFAULT_TIME}`)
  }
  const triggerClass = 'h-11 w-full justify-start gap-3 border-white/10 bg-zinc-950 px-3 text-left font-normal hover:bg-white/5'

  return <div className="grid gap-3 sm:grid-cols-[1fr_11rem]">
    <div className="space-y-2">
      <span className="text-sm font-medium" id="release-date-label">Release date</span>
      <Popover open={dateOpen} onOpenChange={setDateOpen}>
        <PopoverTrigger asChild>
          <Button type="button" variant="outline" aria-labelledby="release-date-label release-date-value" aria-invalid={invalid} className={cn(triggerClass, invalid && 'border-red-400/60')}>
            <CalendarDays className="h-4 w-4 text-emerald-300" />
            <span id="release-date-value" className={day ? 'text-zinc-100' : 'text-zinc-500'}>{day ? format(day, 'EEEE, MMMM d, yyyy') : 'Pick a date'}</span>
          </Button>
        </PopoverTrigger>
        <PopoverContent align="start" className="w-auto border-white/10 bg-[#151518] p-0 text-zinc-100">
          <Calendar
            mode="single"
            showOutsideDays={false}
            selected={day}
            defaultMonth={day ?? earliest}
            fromDate={startOfDay(now)}
            disabled={(candidate) => isBefore(candidate, earliest)}
            onSelect={(picked) => {
              set(picked, time)
              if (picked) {
                setDateOpen(false)
                if (!time) setTimeOpen(true)
              }
            }}
            classNames={{
              day_selected: 'bg-emerald-400 text-zinc-950 hover:bg-emerald-300 hover:text-zinc-950 focus:bg-emerald-400 focus:text-zinc-950',
              day_today: 'border border-white/20 text-zinc-100',
              day_disabled: 'text-zinc-600 line-through opacity-60',
            }}
            initialFocus
          />
          <p className="border-t border-white/10 px-4 py-2.5 text-xs text-zinc-400">Earliest: {format(earliest, 'MMM d')} (7 days for review and prep)</p>
        </PopoverContent>
      </Popover>
    </div>

    <div className="space-y-2">
      <span className="text-sm font-medium" id="release-time-label">Time</span>
      <Popover open={timeOpen} onOpenChange={setTimeOpen}>
        <PopoverTrigger asChild>
          <Button type="button" variant="outline" disabled={!day} aria-labelledby="release-time-label release-time-value" className={triggerClass}>
            <Clock className="h-4 w-4 text-emerald-300" />
            <span id="release-time-value" className={time ? 'text-zinc-100' : 'text-zinc-500'}>{time ? timeLabel(time) : 'Pick a time'}</span>
          </Button>
        </PopoverTrigger>
        <PopoverContent align="end" className="w-64 border-white/10 bg-[#151518] p-3 text-zinc-100">
          <div className="grid grid-cols-4 gap-1.5">
            {QUICK_TIMES.map((quick) => <button key={quick.value} type="button" onClick={() => { set(day, quick.value); setTimeOpen(false) }}
              className={cn('rounded-md border px-1.5 py-1.5 text-xs transition', time === quick.value ? 'border-emerald-400 bg-emerald-400 font-semibold text-zinc-950' : 'border-white/10 text-zinc-300 hover:border-emerald-400/60')}>{quick.label}</button>)}
          </div>
          <div role="listbox" aria-label="Release time" className="mt-3 max-h-56 overflow-y-auto pr-1">
            {TIME_SLOTS.map((slot) => <button key={slot} type="button" role="option" aria-selected={time === slot}
              // Open with the chosen time in view instead of at midnight.
              ref={time === slot ? (element) => element?.scrollIntoView?.({block: 'center'}) : undefined}
              onClick={() => { set(day, slot); setTimeOpen(false) }}
              className={cn('flex w-full items-center justify-between rounded-md px-3 py-2 text-sm transition', time === slot ? 'bg-emerald-400/15 font-semibold text-emerald-300' : 'text-zinc-300 hover:bg-white/5')}>
              {timeLabel(slot)}{time === slot && <span aria-hidden="true">✓</span>}
            </button>)}
          </div>
        </PopoverContent>
      </Popover>
    </div>
  </div>
}
