import {fireEvent, render, screen, within} from '@testing-library/react'
import {useState} from 'react'
import {describe, expect, it, vi} from 'vitest'

import {ReleaseDateTimePicker} from './ReleaseDateTimePicker'

// Radix popovers measure themselves; jsdom has no ResizeObserver.
vi.stubGlobal('ResizeObserver', class { observe() {} unobserve() {} disconnect() {} })

const now = new Date(2026, 9, 21, 12, 0) // Oct 21, 2026, local time

function Harness({initial = '', onChange = vi.fn()}: {initial?: string; onChange?: (value: string) => void}) {
  const [value, setValue] = useState(initial)
  return <ReleaseDateTimePicker value={value} now={now} onChange={(next) => { setValue(next); onChange(next) }} />
}

describe('release date and time picker', () => {
  it('opens a calendar, greys out days under 7 days away, then offers times to pick', () => {
    const onChange = vi.fn()
    render(<Harness onChange={onChange} />)
    expect(screen.getByRole('button', {name: /Time Pick a time/})).toBeDisabled()
    fireEvent.click(screen.getByRole('button', {name: /Release date Pick a date/}))

    const calendar = screen.getByRole('grid')
    expect(screen.getByText('Earliest: Oct 28 (7 days for review and prep)')).toBeInTheDocument()
    expect(within(calendar).getByRole('gridcell', {name: '27'})).toBeDisabled()
    fireEvent.click(within(calendar).getByRole('gridcell', {name: '30'}))
    expect(onChange).toHaveBeenLastCalledWith('2026-10-30T00:00')
    expect(screen.getByRole('button', {name: /Release date Friday, October 30, 2026/})).toBeInTheDocument()

    // Picking a date without a time opens the time list straight away.
    const list = screen.getByRole('listbox', {name: 'Release time'})
    fireEvent.click(within(list).getByRole('option', {name: '7:30 PM'}))
    expect(onChange).toHaveBeenLastCalledWith('2026-10-30T19:30')
    expect(screen.getByRole('button', {name: /Time 7:30 PM/})).toBeInTheDocument()
  })

  it('keeps the chosen time when the date changes and offers quick times', () => {
    const onChange = vi.fn()
    render(<Harness initial="2026-11-05T21:00" onChange={onChange} />)
    fireEvent.click(screen.getByRole('button', {name: /Time 9:00 PM/}))
    fireEvent.click(screen.getByRole('button', {name: 'Noon'}))
    expect(onChange).toHaveBeenLastCalledWith('2026-11-05T12:00')
    fireEvent.click(screen.getByRole('button', {name: /Release date Thursday, November 5, 2026/}))
    fireEvent.click(within(screen.getByRole('grid')).getByRole('gridcell', {name: '20'}))
    expect(onChange).toHaveBeenLastCalledWith('2026-11-20T12:00')
  })
})
