import { describe, it, expect, vi } from 'vitest'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'

import StoryPointsField from '@/components/sprints/StoryPointsField'
import { FIBONACCI_STORY_POINTS } from '@/lib/agile/burndown'

describe('StoryPointsField', () => {
  it('renderiza todas las opciones Fibonacci + "?"', () => {
    render(<StoryPointsField />)
    const select = screen.getByTestId('story-points-field') as HTMLSelectElement
    // 1 (vacío "?") + 7 valores Fibonacci.
    expect(select.options).toHaveLength(FIBONACCI_STORY_POINTS.length + 1)
    expect(select.options[0]?.value).toBe('')
    expect(select.options[1]?.value).toBe('1')
    expect(select.options[FIBONACCI_STORY_POINTS.length]?.value).toBe('21')
  })

  it('respeta el defaultValue', () => {
    render(<StoryPointsField defaultValue={5} />)
    const select = screen.getByTestId('story-points-field') as HTMLSelectElement
    expect(select.value).toBe('5')
  })

  it('emite onChange con número cuando el usuario selecciona un valor', async () => {
    const onChange = vi.fn()
    const user = userEvent.setup()
    render(<StoryPointsField onChange={onChange} />)

    const select = screen.getByTestId('story-points-field')
    await user.selectOptions(select, '8')
    expect(onChange).toHaveBeenLastCalledWith(8)
  })

  it('emite onChange con null cuando el usuario elige "?" (vacío)', async () => {
    const onChange = vi.fn()
    const user = userEvent.setup()
    render(<StoryPointsField defaultValue={5} onChange={onChange} />)

    const select = screen.getByTestId('story-points-field')
    await user.selectOptions(select, '')
    expect(onChange).toHaveBeenLastCalledWith(null)
  })

  it('usa el name por defecto "storyPoints" para FormData', () => {
    render(<StoryPointsField />)
    const select = screen.getByTestId('story-points-field') as HTMLSelectElement
    expect(select.name).toBe('storyPoints')
  })
})
