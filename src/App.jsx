import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { Navigate, Route, Routes, useNavigate, useParams } from 'react-router-dom'
import { load } from 'js-yaml'

import catalogRaw from './data/exercise-catalog.yaml?raw'

const workoutModules = import.meta.glob('./data/workouts/**/*.yaml', {
  query: '?raw',
  import: 'default',
  eager: true,
})

const APP_BASE_URL = import.meta.env.BASE_URL || '/'

const withBaseUrl = (value) => {
  if (!value || typeof value !== 'string') {
    return null
  }

  if (/^(?:[a-z]+:)?\/\//i.test(value) || /^(data|blob):/i.test(value)) {
    return value
  }

  const normalized = value.replace(/^\/+/, '')
  return `${APP_BASE_URL}${normalized}`
}

const parseDurationSeconds = (value) => {
  if (typeof value === 'number' && Number.isFinite(value)) {
    return Math.max(1, Math.round(value))
  }

  if (typeof value === 'string') {
    const match = value.trim().match(/^(\d+)\s*s?$/i)
    if (match) {
      return Math.max(1, Number(match[1]))
    }
  }

  return null
}

const normalizeMediaPath = (value) => {
  if (!value || typeof value !== 'string') {
    return null
  }

  const normalized = value.replace(/^\/+/, '')
  const contentPath = normalized.startsWith('content/')
    ? normalized
    : `content/${normalized}`

  return withBaseUrl(contentPath)
}

const getAllExercisesFromCatalog = (sections) => {
  const items = []
  for (const section of sections) {
    if (Array.isArray(section.items)) {
      items.push(...section.items)
    }
    if (Array.isArray(section.subsections)) {
      for (const sub of section.subsections) {
        if (Array.isArray(sub.items)) {
          items.push(...sub.items)
        }
      }
    }
  }
  return items
}

const parseCatalogWithSections = () => {
  try {
    const parsed = load(catalogRaw)
    if (!Array.isArray(parsed)) return []

    const result = []
    for (const section of parsed) {
      if (!section?.section) continue
      result.push({ type: 'section', text: String(section.section) })

      if (Array.isArray(section.items)) {
        for (const item of section.items) {
          if (!item?.id) continue
          result.push({
            type: 'exercise',
            id: String(item.id),
            display_name: item.display_name ? String(item.display_name) : null,
            image: normalizeMediaPath(item.image),
          })
        }
      }

      if (Array.isArray(section.subsections)) {
        for (const sub of section.subsections) {
          if (!sub?.name) continue
          result.push({ type: 'subsection', text: String(sub.name) })
          for (const item of (sub.items || [])) {
            if (!item?.id) continue
            result.push({
              type: 'exercise',
              id: String(item.id),
              display_name: item.display_name ? String(item.display_name) : null,
              image: normalizeMediaPath(item.image),
            })
          }
        }
      }
    }
    return result
  } catch {
    return []
  }
}

const parseCatalog = () => {
  try {
    const parsed = load(catalogRaw)
    if (!Array.isArray(parsed)) {
      return {}
    }

    const acc = {}
    for (const item of getAllExercisesFromCatalog(parsed)) {
      if (!item || typeof item !== 'object' || !item.id) {
        continue
      }
      acc[String(item.id)] = {
        id: String(item.id),
        display_name: item.display_name ? String(item.display_name) : null,
        image: normalizeMediaPath(item.image),
        video: normalizeMediaPath(item.video),
      }
    }
    return acc
  } catch {
    return {}
  }
}


/**
 * Flatten a potentially-nested plan into { item, groupId } entries.
 * Every top-level element that is itself an array gets its own groupId.
 * Scalar items at the same level share a groupId until the next array
 * boundary.  groupCounter is { value: N } — a shared monotonic counter
 * so that group ids are globally unique across recursive / include calls.
 */
const flattenPlan = (items, groupCounter = { value: 0 }) => {
  const result = []
  let currentGroupId = groupCounter.value
  for (const item of items) {
    if (Array.isArray(item)) {
      groupCounter.value += 1
      result.push(...flattenPlan(item, groupCounter))
      groupCounter.value += 1
      currentGroupId = groupCounter.value
    } else if (item != null) {
      result.push({ item, groupId: currentGroupId })
    }
  }
  return result
}

/**
 * 10 predefined segment color pairs for the workout progress bar.
 * Each entry: [lightColor (unfilled/upcoming), darkColor (filled/completed)].
 * Colors roll over when more than 10 distinct nesting groups exist.
 */
const SEGMENT_COLORS = [
  { light: 'rgba(59,130,246,0.25)', dark: 'rgb(59,130,246)' },   // blue
  { light: 'rgba(249,115,22,0.25)', dark: 'rgb(249,115,22)' },   // orange
  { light: 'rgba(34,197,94,0.25)', dark: 'rgb(34,197,94)' },   // green
  { light: 'rgba(234,179,8,0.25)', dark: 'rgb(234,179,8)' },   // yellow
  { light: 'rgba(168,85,247,0.25)', dark: 'rgb(168,85,247)' },   // purple
  { light: 'rgba(236,72,153,0.25)', dark: 'rgb(236,72,153)' },   // pink
  { light: 'rgba(20,184,166,0.25)', dark: 'rgb(20,184,166)' },   // teal
  { light: 'rgba(239,68,68,0.25)', dark: 'rgb(239,68,68)' },   // red
  { light: 'rgba(99,102,241,0.25)', dark: 'rgb(99,102,241)' },   // indigo
  { light: 'rgba(245,158,11,0.25)', dark: 'rgb(245,158,11)' },   // amber
]

/** Fixed color for rest steps — neutral gray / dark. */
const REST_COLOR = { light: 'rgba(115,115,115,0.25)', dark: 'rgb(64,64,64)' }

/**
 * Assign a color index to each step based on group-id transitions.
 * Every time the groupId changes compared to the previous non-rest step,
 * the color advances. Rest steps inherit the current color (rendered gray
 * at display time) and don't affect the group tracking so an inter-set
 * rest doesn't spuriously merge or split groups.
 */
const assignColorIndices = (groupPerStep, isRestPerStep) => {
  if (groupPerStep.length === 0) return []
  const result = []
  let colorIndex = 0
  let prevGroup = null
  for (let i = 0; i < groupPerStep.length; i++) {
    if (isRestPerStep[i]) {
      result.push(colorIndex)
      continue
    }
    if (prevGroup !== null && groupPerStep[i] !== prevGroup) {
      colorIndex = (colorIndex + 1) % SEGMENT_COLORS.length
    }
    prevGroup = groupPerStep[i]
    result.push(colorIndex)
  }
  return result
}

/**
 * Recursively process a flat plan (already flattened by flattenPlan) and push
 * resolved steps into processedPlan / groupPerStep / isRestPerStep.
 * Handles nested `include` directives at any depth.
 */
const processFlatPlan = (flatPlan, processedPlan, groupPerStep, isRestPerStep, groupCounter) => {
  for (const { item, groupId } of flatPlan) {
    if (!item || typeof item !== 'object') {
      continue
    }

    // Handle step objects
    if (item.step) {
      const step = item.step
      if (!step?.exercise_id) {
        continue
      }

      const reps = parseReps(step.reps)
      const seconds = reps
        ? reps.total_duration_s
        : (parseDurationSeconds(step.duration_s) ??
          parseDurationSeconds(step.durations_s))

      if (!seconds) {
        continue
      }

      processedPlan.push({
        id: String(step.exercise_id),
        label: step.label ? String(step.label) : null,
        duration_s: seconds,
        reps: reps ?? null,
        image_flip: Boolean(step.image_flip),
        weight: step.weight ? String(step.weight) : null,
      })
      groupPerStep.push(groupId)
      isRestPerStep.push(String(step.exercise_id) === 'rest')
    }

    // Handle include directives — recurse so nested includes are resolved
    if (item.include) {
      const includeFileName = String(item.include)
      const includeModule = workoutModules[`./data/workouts/${includeFileName}`]
      if (includeModule) {
        try {
          const includedData = load(includeModule)
          if (Array.isArray(includedData.plan)) {
            groupCounter.value += 1
            const flatIncludedPlan = flattenPlan(includedData.plan, groupCounter)
            groupCounter.value += 1
            processFlatPlan(flatIncludedPlan, processedPlan, groupPerStep, isRestPerStep, groupCounter)
          }
        } catch {
          // Ignore errors in included files
        }
      }
    }
  }
}

const parseWorkouts = () => {
  return Object.entries(workoutModules)
    .filter(([modulePath]) => !modulePath.includes('/internal/'))
    .map(([modulePath, raw]) => {
      try {
        const parsed = load(raw)
        if (!parsed?.name || !Array.isArray(parsed.plan)) {
          return null
        }

        const processedPlan = []
        const groupPerStep = []
        const isRestPerStep = []
        const groupCounter = { value: 0 }
        const flatPlan = flattenPlan(parsed.plan, groupCounter)
        processFlatPlan(flatPlan, processedPlan, groupPerStep, isRestPerStep, groupCounter)

        if (processedPlan.length === 0) {
          return null
        }

        const colorIndices = assignColorIndices(groupPerStep, isRestPerStep)
        for (let i = 0; i < processedPlan.length; i++) {
          processedPlan[i].colorIndex = colorIndices[i] ?? 0
        }

        // Extract subfolder relative to the workouts directory.
        // e.g. './data/workouts/bodyweight-circuits/glutes.yaml' → 'bodyweight-circuits'
        //      './data/workouts/upper-body-a.yaml' → ''
        const relPath = modulePath.replace(/^\.?\/?(data\/workouts\/)?/, '')
        const parts = relPath.split('/')
        const folder = parts.length > 1 ? parts.slice(0, -1).join('/') : ''

        return {
          id: modulePath.split('/').pop().replace('.yaml', ''),
          name: String(parsed.name),
          description: String(parsed.description ?? ''),
          folder,
          plan: processedPlan,
          filePath: modulePath.replace(/^\.\//, ''),
        }
      } catch {
        return null
      }
    })
    .filter(Boolean)
    .sort((a, b) => a.id.localeCompare(b.id))
}

const formatClock = (secondsLeft) => {
  const total = Math.floor(secondsLeft)
  const mins = Math.floor(total / 60)
  const secs = total % 60
  return `${String(mins).padStart(2, '0')}:${String(secs).padStart(2, '0')}`
}

const playTone = (frequency, durationMs, type = 'sine') => {
  try {
    const AudioCtx = window.AudioContext || window.webkitAudioContext
    if (!AudioCtx) {
      return false
    }

    const context = new AudioCtx()
    const oscillator = context.createOscillator()
    const gainNode = context.createGain()
    oscillator.type = type
    oscillator.frequency.value = frequency
    gainNode.gain.value = 0.12

    oscillator.connect(gainNode)
    gainNode.connect(context.destination)
    oscillator.start()
    oscillator.stop(context.currentTime + durationMs / 1000)

    oscillator.onended = () => {
      context.close().catch(() => { })
    }

    return true
  } catch {
    return false
  }
}

const playShortBeep = () => {
  playTone(880, 120, 'square')
}

const playTick = () => {
  playTone(220, 60, 'sine')
}

const speakText = (text) => {
  try {
    if (!window.speechSynthesis) return
    window.speechSynthesis.cancel()
    const utterance = new SpeechSynthesisUtterance(String(text))
    utterance.lang = 'en-US'
    utterance.rate = 1.1
    utterance.volume = 1
    speechSynthesis.speak(utterance)
  } catch (err) {
    console.error('Speech synthesis error:', err)
  }
}

const parseReps = (repsObj) => {
  if (!repsObj || typeof repsObj !== 'object') return null

  const prepS = Math.max(0, Math.round(Number(repsObj.prep_s) || 0))
  const repsNum = Math.max(1, Math.round(Number(repsObj.reps_num) || 1))
  const repDurationS = Math.max(1, Math.round((Number(repsObj.rep_duration_s) || 3) * 2) / 2)

  // INITIAL_REP_PERIOD_S go-period + final rep period after last counted rep
  const totalDuration = prepS + INITIAL_REP_PERIOD_S + (repsNum + 1) * repDurationS

  return { prep_s: prepS, get_ready_s: 0, reps_num: repsNum, rep_duration_s: repDurationS, total_duration_s: totalDuration }
}

/**
 * Given elapsed seconds into a reps-based step, determine the current phase.
 * Returns { phase: 'prep' | 'rep' | 'done', countdown?, repNumber?, timeIntoCurrentRep? }
 */
const getRepsPhase = (elapsedSeconds, reps) => {
  if (!reps) return null

  const getReady = reps.get_ready_s

  if (elapsedSeconds < getReady) {
    return { phase: 'get-ready' }
  }

  if (elapsedSeconds < getReady + reps.prep_s) {
    return { phase: 'prep', countdown: getReady + reps.prep_s - elapsedSeconds }
  }

  const timeIntoReps = elapsedSeconds - getReady - reps.prep_s
  const repsTimeTotal = INITIAL_REP_PERIOD_S + (reps.reps_num + 1) * reps.rep_duration_s

  if (timeIntoReps >= repsTimeTotal) {
    return { phase: 'done' }
  }

  const timeAfterInitial = timeIntoReps - INITIAL_REP_PERIOD_S
  const completedReps = timeAfterInitial < 0 ? 0 : Math.min(reps.reps_num, Math.floor(timeAfterInitial / reps.rep_duration_s))
  const timeIntoCurrentRep = timeAfterInitial < 0 ? timeIntoReps : timeAfterInitial % reps.rep_duration_s
  return { phase: 'rep', completedReps, timeIntoCurrentRep }
}

const LONG_BEEP_DURATION_MS = 500
const INITIAL_REP_PERIOD_S = 1
const GET_READY_SPEAK_DELAY_MS = 1000
const DURATION_BEEP_COUNTDOWN_S = 3

const playLongBeep = () => {
  playTone(660, LONG_BEEP_DURATION_MS, 'square')
}

const playFanfare = () => {
  try {
    const AudioCtx = window.AudioContext || window.webkitAudioContext
    if (!AudioCtx) {
      return
    }

    const context = new AudioCtx()
    const gainNode = context.createGain()
    gainNode.gain.value = 0.1
    gainNode.connect(context.destination)

      ;[
        [523.25, 0],
        [659.25, 0.12],
        [783.99, 0.24],
        [1046.5, 0.4],
      ].forEach(([freq, offset]) => {
        const osc = context.createOscillator()
        osc.type = 'triangle'
        osc.frequency.value = freq
        osc.connect(gainNode)
        osc.start(context.currentTime + offset)
        osc.stop(context.currentTime + offset + 0.2)
      })

    window.setTimeout(() => {
      context.close().catch(() => { })
    }, 800)
  } catch {
    // Ignore audio errors and continue workout flow.
  }
}

const playCompletionSequence = () => {
  playLongBeep()
  window.setTimeout(() => {
    playFanfare()
  }, LONG_BEEP_DURATION_MS + 80)
}

const slugify = (text) =>
  text.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '')

function CatalogView({ items, workouts }) {
  const navigate = useNavigate()
  const exerciseWorkoutsMap = useMemo(() => {
    const map = {}
    for (const workout of workouts) {
      const seen = new Set()
      for (const step of workout.plan) {
        if (!seen.has(step.id)) {
          seen.add(step.id)
          if (!map[step.id]) map[step.id] = []
          map[step.id].push({ id: workout.id, name: workout.name })
        }
      }
    }
    return map
  }, [workouts])

  const tocEntries = useMemo(
    () =>
      items
        .filter((item) => item.type === 'section')
        .map((item) => ({ text: item.text, slug: slugify(item.text) })),
    [items],
  )

  const exerciseNumbers = useMemo(() => {
    const nums = []
    let num = 0
    for (const item of items) {
      if (item.type === 'exercise') {
        num += 1
        nums.push(num)
      } else {
        nums.push(0)
      }
    }
    return nums
  }, [items])

  return (
    <div className="flex items-start gap-6">
      {/* Table of contents — only on wide screens */}
      <nav className="hidden xl:block w-52 shrink-0 sticky top-4 self-start max-h-[calc(100vh-2rem)] overflow-y-auto rounded-lg bg-gray-50 border border-gray-200 p-3">
        <button
          type="button"
          className="rounded border border-gray-300 bg-white px-3 py-2 text-sm"
          onClick={() => navigate('/')}
          data-cy="catalog-back"
        >
          Menu
        </button>
        <p className="mt-4 mb-2 text-xs font-bold uppercase tracking-widest text-gray-500">Contents</p>
        <ul className="space-y-px text-sm">
          {tocEntries.map((entry) => (
            <li key={entry.slug}>
              <a
                href={`#${entry.slug}`}
                className="block py-0.5 font-semibold text-gray-800 hover:text-blue-600"
                onClick={(e) => {
                  e.preventDefault()
                  document.getElementById(entry.slug)?.scrollIntoView({ behavior: 'smooth' })
                }}
              >
                {entry.text}
              </a>
            </li>
          ))}
        </ul>
      </nav>

      <main className="min-w-0 flex-1 space-y-4 pb-[500px]" data-cy="catalog-view">
        <div className="flex items-center justify-between">
          <h1 className="text-2xl font-semibold">Exercise Catalog</h1>
        </div>

        <table className="w-full border-collapse text-sm">
          <thead>
            <tr className="border-b-2 border-gray-300 bg-gray-50">
              <th className="p-2 text-left font-semibold text-gray-700">Num.</th>
              <th className="p-2 text-left font-semibold text-gray-700">ID</th>
              <th className="p-2 text-left font-semibold text-gray-700">Name</th>
              <th className="p-2 text-left font-semibold text-gray-700">Includes</th>
              <th className="p-2 text-left font-semibold text-gray-700">Workouts</th>
            </tr>
          </thead>
          <tbody>
            {items.map((item, index) => {
              if (item.type === 'section') {
                return (
                  <tr key={`section-${index}`} id={slugify(item.text)} className="bg-gray-800">
                    <td colSpan={5} className="px-3 py-1.5 text-xs font-bold uppercase tracking-widest text-gray-100">
                      {item.text}
                    </td>
                  </tr>
                )
              }
              if (item.type === 'subsection') {
                return (
                  <tr key={`subsection-${index}`} id={slugify(item.text)} className="bg-gray-100">
                    <td colSpan={5} className="px-3 py-1 pl-5 text-xs font-semibold italic text-gray-600">
                      {item.text}
                    </td>
                  </tr>
                )
              }
              const exerciseNum = exerciseNumbers[index]
              return (
                <tr key={item.id} className="border-b border-gray-200 hover:bg-gray-50">
                  <td className="p-2 align-top text-gray-400">{exerciseNum}</td>
                  <td className="p-2 align-top">
                    <div className="group relative inline-block">
                      {item.image ? (
                        <a
                          href={item.image}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="font-mono text-xs text-blue-600 underline decoration-dotted"
                        >
                          {item.id}
                        </a>
                      ) : (
                        <span className="cursor-default font-mono text-xs text-gray-600 underline decoration-dotted">
                          {item.id}
                        </span>
                      )}
                      {item.image && (
                        <div className="pointer-events-none absolute left-0 top-full z-10 mt-1 hidden rounded border border-gray-300 bg-white p-1 shadow-lg group-hover:block">
                          <div style={{ width: 200, height: 200 }}>
                            <img
                              src={item.image}
                              alt={item.display_name ?? item.id}
                              style={{ width: '100%', height: '100%', objectFit: 'contain' }}
                            />
                          </div>
                        </div>
                      )}
                    </div>
                  </td>
                  <td className="p-2 align-top">{item.display_name ?? item.id}</td>
                  <td className="p-2 align-top text-center text-gray-600">
                    {exerciseWorkoutsMap[item.id]?.length ?? 0}
                  </td>
                  <td className="p-2 align-top text-gray-600">
                    {exerciseWorkoutsMap[item.id]
                      ? exerciseWorkoutsMap[item.id].map((w, i) => (
                        <span key={w.id}>
                          {i > 0 && ', '}
                          <button
                            type="button"
                            className="text-blue-600 hover:underline"
                            onClick={() => navigate(`/workout/${w.id}`)}
                          >
                            {w.name}
                          </button>
                        </span>
                      ))
                      : '—'}
                  </td>
                </tr>
              )
            })}
          </tbody>
        </table>
      </main>
    </div>
  )
}

const formatFolderName = (folder) => {
  if (!folder) return 'Workouts'
  return folder
    .split('/')
    .map((seg) => seg.replace(/[-_]+/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase()))
    .join(' / ')
}

function MenuPage({ workouts }) {
  const navigate = useNavigate()

  const groups = useMemo(() => {
    const map = new Map()
    for (const workout of workouts) {
      const key = workout.folder ?? ''
      if (!map.has(key)) map.set(key, [])
      map.get(key).push(workout)
    }
    // Sort groups: root ('') first, then alphabetical
    return [...map.entries()].sort(([a], [b]) => {
      if (a === '' && b !== '') return -1
      if (a !== '' && b === '') return 1
      return a.localeCompare(b)
    })
  }, [workouts])

  return (
    <main className="space-y-6" data-cy="menu-view">
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-semibold">Workout Menu</h1>
        <a
          href="https://github.com/5tan/stan-workout"
          aria-label="View source on GitHub"
          className="text-gray-500 hover:text-gray-900 transition-colors"
        >
          <svg height="28" width="28" viewBox="0 0 16 16" aria-hidden="true" fill="currentColor">
            <path d="M8 0C3.58 0 0 3.58 0 8c0 3.54 2.29 6.53 5.47 7.59.4.07.55-.17.55-.38 0-.19-.01-.82-.01-1.49-2.01.37-2.53-.49-2.69-.94-.09-.23-.48-.94-.82-1.13-.28-.15-.68-.52-.01-.53.63-.01 1.08.58 1.23.82.72 1.21 1.87.87 2.33.66.07-.52.28-.87.51-1.07-1.78-.2-3.64-.89-3.64-3.95 0-.87.31-1.59.82-2.15-.08-.2-.36-1.02.08-2.12 0 0 .67-.21 2.2.82.64-.18 1.32-.27 2-.27.68 0 1.36.09 2 .27 1.53-1.04 2.2-.82 2.2-.82.44 1.1.16 1.92.08 2.12.51.56.82 1.27.82 2.15 0 3.07-1.87 3.75-3.65 3.95.29.25.54.73.54 1.48 0 1.07-.01 1.93-.01 2.2 0 .21.15.46.55.38A8.013 8.013 0 0 0 16 8c0-4.42-3.58-8-8-8z" />
          </svg>
        </a>
      </div>
      <p className="text-sm text-gray-700">
        Choose a workout.
      </p>

      {groups.map(([folder, items]) => (
        <div key={folder} className="space-y-2">
          <h2 className="text-xs font-semibold uppercase tracking-widest text-gray-400">{formatFolderName(folder)}</h2>
          <div className="grid gap-3 sm:grid-cols-2">
            {items.map((workout) => (
              <button
                key={workout.id}
                type="button"
                className="rounded border border-gray-300 bg-white p-4 text-left"
                onClick={() => navigate(`/workout/${workout.id}`)}
                data-cy={`workout-${workout.id}`}
              >
                <div className="font-medium">{workout.name}</div>
                <div className="text-sm text-gray-600">
                  {workout.description}
                </div>
                <div className="mt-1 text-sm text-gray-500">
                  {formatClock(workout.plan.reduce((sum, step) => sum + step.duration_s, 0))}
                </div>
              </button>
            ))}
          </div>
        </div>
      ))}

      {workouts.length === 0 && (
        <p className="rounded border border-red-300 bg-red-50 p-3 text-sm text-red-700">
          No valid workouts found.
        </p>
      )}

      <div className="border-t border-gray-200 pt-3">
        <button
          type="button"
          className="text-sm text-blue-600 hover:underline"
          onClick={() => navigate('/catalog')}
          data-cy="nav-catalog"
        >
          Exercise Catalog
        </button>
      </div>
    </main>
  )
}

function WorkoutPage({ workouts, catalog }) {
  const { workoutId } = useParams()
  const navigate = useNavigate()

  // remainingTicks is an integer count of half-seconds (1 tick = 0.5 s).
  // All timer arithmetic uses integers to avoid floating-point drift.
  const toTicks = (s) => Math.round(s * 2)
  const initialTicks = toTicks(workouts.find((item) => item.id === workoutId)?.plan?.[0]?.duration_s ?? 0)

  const [currentStepIndex, setCurrentStepIndex] = useState(0)
  const [remainingTicks, setRemainingTicks] = useState(initialTicks)
  const [isRunning, setIsRunning] = useState(false)
  const [completed, setCompleted] = useState(false)
  const [mediaMissing, setMediaMissing] = useState(false)
  const [wakeLockIssue, setWakeLockIssue] = useState(false)
  const [view, setView] = useState('workout')

  const wakeLockRef = useRef(null)
  const remainingTicksRef = useRef(initialTicks)
  const getReadySpokenRef = useRef(-1)
  const prevStepIndexRef = useRef(0)
  const wakeLockSupported = typeof navigator !== 'undefined' && 'wakeLock' in navigator

  const stepJustChanged = prevStepIndexRef.current !== currentStepIndex
  useEffect(() => { prevStepIndexRef.current = currentStepIndex })

  const selectedWorkout = useMemo(
    () => workouts.find((item) => item.id === workoutId) ?? null,
    [workoutId, workouts],
  )

  // Initialize state when navigating to a workout (or redirect if workoutId is invalid)
  useEffect(() => {
    if (!selectedWorkout) {
      navigate('/', { replace: true })
      return
    }
    setCurrentStepIndex(0)
    getReadySpokenRef.current = -1
    remainingTicksRef.current = toTicks(selectedWorkout.plan[0].duration_s)
    setRemainingTicks(toTicks(selectedWorkout.plan[0].duration_s))
    setIsRunning(false)
    setCompleted(false)
    setMediaMissing(false)
    setWakeLockIssue(false)
    prevStepIndexRef.current = 0
  }, [selectedWorkout, navigate])

  const currentStep = selectedWorkout?.plan?.[currentStepIndex] ?? null
  const totalExercises = selectedWorkout?.plan?.length ?? 0
  const currentExerciseNumber = totalExercises > 0 ? currentStepIndex + 1 : 0

  const currentExerciseDuration = currentStep?.duration_s ?? 1
  const remainingSeconds = Math.floor(remainingTicks / 2)
  const exerciseElapsedSeconds = Math.max(0, currentExerciseDuration - remainingSeconds)
  const exerciseProgress = completed
    ? 100
    : Math.min(100, Math.max(0, (exerciseElapsedSeconds / currentExerciseDuration) * 100))

  const totalWorkoutSeconds = selectedWorkout
    ? selectedWorkout.plan.reduce((sum, step) => sum + step.duration_s, 0)
    : 1
  const elapsedBeforeCurrentStep = selectedWorkout
    ? selectedWorkout.plan
      .slice(0, currentStepIndex)
      .reduce((sum, step) => sum + step.duration_s, 0)
    : 0
  const elapsedWorkoutSeconds = Math.min(
    totalWorkoutSeconds,
    elapsedBeforeCurrentStep + exerciseElapsedSeconds,
  )
  const workoutProgress = completed
    ? 100
    : Math.min(100, Math.max(0, (elapsedWorkoutSeconds / totalWorkoutSeconds) * 100))

  const workoutStepProgress = selectedWorkout
    ? selectedWorkout.plan.map((_, index) => {
      if (completed || index < currentStepIndex) {
        return 100
      }
      if (index > currentStepIndex) {
        return 0
      }
      return exerciseProgress
    })
    : []

  const currentMedia = useMemo(() => {
    if (!currentStep) {
      return null
    }

    return catalog[currentStep.id] ?? null
  }, [catalog, currentStep])

  const currentStepDisplayName = currentMedia?.display_name
    ? (currentStep?.label ? `${currentMedia.display_name} (${currentStep.label})` : currentMedia.display_name)
    : (currentStep?.id ?? 'N/A')

  const nextStep = selectedWorkout?.plan?.[currentStepIndex + 1] ?? null
  const nextMedia = nextStep ? (catalog[nextStep.id] ?? null) : null
  const nextStepDisplayName = nextStep
    ? (nextMedia?.display_name
      ? (nextStep.label ? `${nextMedia.display_name} (${nextStep.label})` : nextMedia.display_name)
      : nextStep.id)
    : null

  const mediaTransformStyle = currentStep?.image_flip
    ? { transform: 'scaleX(-1)' }
    : undefined

  const releaseWakeLock = useCallback(async () => {
    if (!wakeLockRef.current) {
      return
    }

    try {
      await wakeLockRef.current.release()
    } catch {
      // Ignore release errors and clear local ref.
    } finally {
      wakeLockRef.current = null
    }
  }, [])

  const requestWakeLock = useCallback(async () => {
    if (!wakeLockSupported || wakeLockRef.current) {
      return
    }

    try {
      const wakeLock = await navigator.wakeLock.request('screen')
      wakeLockRef.current = wakeLock
      setWakeLockIssue(false)

      wakeLock.addEventListener('release', () => {
        if (wakeLockRef.current === wakeLock) {
          wakeLockRef.current = null
        }
      })
    } catch {
      setWakeLockIssue(true)
    }
  }, [wakeLockSupported])

  useEffect(() => {
    if (!selectedWorkout || !isRunning || completed) {
      return undefined
    }

    // Announce "get ready" once at the start of a reps step with prep time
    const initialStep = selectedWorkout.plan[currentStepIndex]
    if (initialStep?.reps?.prep_s > 0 && getReadySpokenRef.current !== currentStepIndex) {
      getReadySpokenRef.current = currentStepIndex
      setTimeout(() => speakText('get ready'), GET_READY_SPEAK_DELAY_MS)
    }

    const startTime = Date.now()
    const startTicks = remainingTicksRef.current
    let lastProcessedTick = 0  // how many ticks we've already acted on

    const intervalId = window.setInterval(() => {
      const elapsedMs = Date.now() - startTime
      const elapsedTotalTicks = Math.floor(elapsedMs / 500)

      // Process all ticks that have elapsed since last check (catches up if interval fired late)
      for (let t = lastProcessedTick + 1; t <= elapsedTotalTicks; t++) {
        const next = startTicks - t
        const step = selectedWorkout.plan[currentStepIndex]

        if (next > 0) {
          // --- Side effects (audio/speech) — run once per tick ---
          // All arithmetic is in integer ticks (1 tick = 0.5 s) to avoid float drift.
          let hadBeep = false
          if (step?.reps) {
            const stepTicks = toTicks(step.duration_s)
            const elapsedTicks = stepTicks - next
            const reps = step.reps
            const prepTicks = toTicks(reps.prep_s)
            const repDurTicks = toTicks(reps.rep_duration_s)
            const initialTicks_ = toTicks(INITIAL_REP_PERIOD_S)

            // Countdown phase: speak last 3 seconds as words
            if (elapsedTicks < prepTicks) {
              const remainingTicks_ = prepTicks - elapsedTicks
              if (remainingTicks_ === 6) speakText('three')  // 6 ticks = 3 s
              else if (remainingTicks_ === 4) speakText('two')
              else if (remainingTicks_ === 2) speakText('one')
            }
            // Transition to reps: say "Go!"
            else if (elapsedTicks === prepTicks) {
              speakText('Go!')
            }
            // Rep phase: announce rep number (counting down) at end of each rep interval
            else {
              const timeIntoRepsTicks = elapsedTicks - prepTicks
              const timeAfterInitialTicks = timeIntoRepsTicks - initialTicks_
              if (timeAfterInitialTicks > 0 && timeAfterInitialTicks % repDurTicks === 0) {
                const repNumber = timeAfterInitialTicks / repDurTicks
                const repsRemaining = reps.reps_num - repNumber + 1
                if (repsRemaining >= 1 && repsRemaining <= reps.reps_num) {
                  speakText(String(repsRemaining))
                }
              }
            }
          } else {
            // Duration-based: beep in last DURATION_BEEP_COUNTDOWN_S seconds, once per whole second
            if (next <= toTicks(DURATION_BEEP_COUNTDOWN_S) && next % 2 === 0) {
              hadBeep = true
              playShortBeep()
            }
          }

          // Audible tick on every whole second, skip when a beep already played
          if (next % 2 === 0 && !hadBeep) {
            playTick()
          }

          remainingTicksRef.current = next
          setRemainingTicks(next)
        } else {
          // --- Step finished ---
          lastProcessedTick = t
          window.clearInterval(intervalId)

          const nextStepIndex = currentStepIndex + 1
          if (nextStepIndex >= selectedWorkout.plan.length) {
            remainingTicksRef.current = 0
            setRemainingTicks(0)
            setIsRunning(false)
            setCompleted(true)
            playCompletionSequence()
            return
          }

          playLongBeep()
          const nextTicks = toTicks(selectedWorkout.plan[nextStepIndex].duration_s)
          remainingTicksRef.current = nextTicks
          setRemainingTicks(nextTicks)
          setMediaMissing(false)
          setCurrentStepIndex(nextStepIndex)
          return
        }
      }

      lastProcessedTick = elapsedTotalTicks
    }, 100)

    return () => {
      window.clearInterval(intervalId)
    }
  }, [selectedWorkout, isRunning, completed, currentStepIndex])

  useEffect(() => {
    if (!selectedWorkout || !catalog) return undefined
    const preloadCount = 2
    for (let i = 1; i <= preloadCount; i++) {
      const step = selectedWorkout.plan[currentStepIndex + i]
      if (!step) break
      const media = catalog[step.id]
      if (media?.image) {
        const img = new Image()
        img.src = media.image
      }
    }
    return undefined
  }, [selectedWorkout, catalog, currentStepIndex])

  useEffect(() => {
    if (selectedWorkout && isRunning && !completed) {
      requestWakeLock()
      return undefined
    }

    releaseWakeLock()
    return undefined
  }, [selectedWorkout, isRunning, completed, requestWakeLock, releaseWakeLock])

  useEffect(() => {
    const handleVisibilityChange = () => {
      if (
        document.visibilityState === 'visible' &&
        selectedWorkout &&
        isRunning &&
        !completed
      ) {
        requestWakeLock()
      }
    }

    document.addEventListener('visibilitychange', handleVisibilityChange)
    return () => {
      document.removeEventListener('visibilitychange', handleVisibilityChange)
    }
  }, [selectedWorkout, isRunning, completed, requestWakeLock])

  useEffect(() => {
    return () => {
      releaseWakeLock()
    }
  }, [releaseWakeLock])

  const jumpToStep = (index) => {
    if (!selectedWorkout) {
      return
    }

    if (index >= selectedWorkout.plan.length) {
      setIsRunning(false)
      setCompleted(true)
      playCompletionSequence()
      return
    }

    const nextIndex = Math.max(0, Math.min(index, selectedWorkout.plan.length - 1))
    setCurrentStepIndex(nextIndex)
    remainingTicksRef.current = toTicks(selectedWorkout.plan[nextIndex].duration_s)
    setRemainingTicks(toTicks(selectedWorkout.plan[nextIndex].duration_s))
    setCompleted(false)
    setMediaMissing(false)
  }

  const jumpToSecondInCurrentStep = (elapsedSeconds) => {
    if (!selectedWorkout || !currentStep) return
    const clamped = Math.max(0, Math.min(elapsedSeconds, currentExerciseDuration - 1))
    const newRemaining = toTicks(currentExerciseDuration - clamped)
    remainingTicksRef.current = newRemaining
    setRemainingTicks(newRemaining)
    setCompleted(false)
  }

  const handleExerciseBarClick = (e) => {
    const rect = e.currentTarget.getBoundingClientRect()
    const fraction = Math.max(0, Math.min(1, (e.clientX - rect.left) / rect.width))
    const targetSecond = Math.floor(fraction * currentExerciseDuration)
    jumpToSecondInCurrentStep(targetSecond)
  }

  const handleWorkoutBarClick = (e) => {
    if (!selectedWorkout) return
    // Walk through each segment's flex-grow share to find which step was clicked
    const rect = e.currentTarget.getBoundingClientRect()
    const clickX = e.clientX - rect.left
    const barWidth = rect.width
    const fraction = Math.max(0, Math.min(1, clickX / barWidth))
    const targetSeconds = fraction * totalWorkoutSeconds
    let cumulative = 0
    for (let i = 0; i < selectedWorkout.plan.length; i++) {
      cumulative += selectedWorkout.plan[i].duration_s
      if (targetSeconds < cumulative) {
        jumpToStep(i)
        return
      }
    }
    jumpToStep(selectedWorkout.plan.length - 1)
  }

  const toggleRunning = () => {
    setIsRunning((prev) => !prev)
  }

  if (!selectedWorkout) {
    return null
  }

  return (
    <main
      className="flex h-[calc(100dvh-2rem)] min-h-0 flex-col gap-2 overflow-hidden sm:h-[calc(100dvh-3rem)]"
      data-cy="workout-view"
    >
      <div className="flex flex-wrap items-center justify-between gap-3">
        <button
          type="button"
          className="flex h-10 w-10 items-center justify-center rounded border border-gray-300 bg-white"
          onClick={() => setView(view === 'workout' ? 'preview' : 'workout')}
          data-cy="toggle-view"
          title={view === 'workout' ? 'Workout Preview' : 'Back to Workout'}
        >
          {view === 'workout' ? (
            <svg width="20" height="20" fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" d="M4 6h16M4 12h16M4 18h16" />
            </svg>
          ) : (
            <svg width="20" height="20" fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" d="M15 19l-7-7 7-7" />
            </svg>
          )}
        </button>
        <h1 className="text-xl font-semibold">
          <a
            href={`https://github.com/5tan/stan-workout/blob/main/src/${selectedWorkout.filePath}`}
            rel="noopener noreferrer"
            className="hover:underline"
          >
            {selectedWorkout.name}
          </a>
        </h1>
        <button
          type="button"
          className="rounded border border-gray-300 bg-white px-3 py-2 text-sm"
          onClick={() => navigate('/')}
          data-cy="back-to-menu"
        >
          Menu
        </button>
      </div>

      {view === 'workout' ? (
        <>
          <div className="rounded border border-gray-300 bg-white p-3">
            <div className="text-lg font-medium" data-cy="current-step-name">
              <span className="text-gray-600">
                ({currentExerciseNumber}/{totalExercises})
              </span>
              <span className="text-black"> {currentStepDisplayName}</span>
            </div>

            <div className="mt-1 flex flex-wrap items-end gap-2">
              <div className="flex flex-wrap items-end gap-2">
                <div className="text-5xl font-bold tabular-nums" data-cy="timer">
                  {formatClock(remainingSeconds)}
                </div>
              </div>

              <div className="ml-auto flex flex-wrap justify-end gap-2">
                <button
                  type="button"
                  className="rounded border border-gray-300 px-3 py-2"
                  onClick={toggleRunning}
                  data-cy="start-pause"
                >
                  {isRunning ? 'Pause' : 'Start'}
                </button>
                <button
                  type="button"
                  className="rounded border border-gray-300 px-3 py-2"
                  onClick={() => jumpToStep(currentStepIndex - 1)}
                  data-cy="prev-step"
                >
                  Prev
                </button>
                <button
                  type="button"
                  className="rounded border border-gray-300 px-3 py-2"
                  onClick={() => jumpToStep(currentStepIndex + 1)}
                  data-cy="next-step"
                >
                  Next
                </button>
              </div>
            </div>

            <div className="mt-2 space-y-2">
              <div>
                <div className="mb-0.5 flex items-center justify-between text-sm text-gray-600">
                  <span>
                    Exercise: {formatClock(exerciseElapsedSeconds)} / {formatClock(currentExerciseDuration)}, ETA: {formatClock(remainingSeconds)}{currentStep?.reps && (
                      <span className="ml-1 text-sm text-gray-400">- {currentStep.reps.reps_num} reps x {currentStep.reps.rep_duration_s}s</span>
                    )}
                  </span>
                  <span className="text-xs text-gray-500">{Math.round(exerciseProgress)}%</span>
                </div>
                <div
                  className="h-3 w-full cursor-pointer overflow-hidden rounded bg-gray-200"
                  data-cy="exercise-progress-bar"
                  onClick={handleExerciseBarClick}
                  role="button"
                  tabIndex={0}
                >
                  <div
                    className="h-full bg-blue-500 pointer-events-none"
                    style={{ width: `${exerciseProgress}%`, transition: stepJustChanged ? 'none' : 'width 1s linear' }}
                  />
                </div>
              </div>

              <div>
                <div
                  className="mb-0.5 flex items-center justify-between text-sm text-gray-600"
                  data-cy="workout-progress-label"
                >
                  <span>
                    Workout: {formatClock(elapsedWorkoutSeconds)} / {formatClock(totalWorkoutSeconds)}, ETA: {formatClock(totalWorkoutSeconds - elapsedWorkoutSeconds)}
                  </span>
                  <span className="text-xs text-gray-500">{Math.round(workoutProgress)}%</span>
                </div>
                <div
                  className="h-3 w-full cursor-pointer overflow-hidden rounded bg-gray-200"
                  data-cy="workout-progress-bar"
                  onClick={handleWorkoutBarClick}
                  role="button"
                  tabIndex={0}
                >
                  <div className="flex h-full w-full gap-px bg-gray-200">
                    {workoutStepProgress.map((segmentProgress, segmentIndex) => {
                      const step = selectedWorkout?.plan?.[segmentIndex]
                      const isRest = step?.id === 'rest'
                      const colors = isRest ? REST_COLOR : SEGMENT_COLORS[step?.colorIndex ?? 0]
                      return (
                        <div
                          key={segmentIndex}
                          className="h-full basis-0"
                          style={{
                            flexGrow: step?.duration_s ?? 1,
                            backgroundColor: colors.light,
                          }}
                        >
                          <div
                            className="h-full"
                            style={{
                              width: `${segmentProgress}%`,
                              backgroundColor: colors.dark,
                              transition: stepJustChanged ? 'none' : 'width 1s linear',
                            }}
                          />
                        </div>
                      )
                    })}
                  </div>
                </div>
              </div>
            </div>

          </div>

          {(wakeLockIssue || !wakeLockSupported) && (
            <p className="text-xs text-amber-700" data-cy="wake-lock-note">
              Screen wake lock is unavailable. Your phone may dim or lock during workout.
            </p>
          )}

          {!completed && (
            <div className="relative flex min-h-0 flex-1 rounded border border-gray-300 bg-white p-3">
              {currentStep?.reps && (() => {
                const phase = getRepsPhase(Math.floor(exerciseElapsedSeconds), currentStep.reps)
                const total = currentStep.reps.reps_num
                const showCountdown = phase?.phase === 'get-ready' || phase?.phase === 'prep'
                const countdown = phase?.phase === 'prep' ? Math.ceil(phase.countdown) : currentStep.reps.prep_s
                return (
                  <div className="absolute left-4 top-4 z-10 flex flex-col items-center">
                    <div className="flex h-24 w-24 flex-col items-center justify-center rounded bg-blue-300 p-1">
                      {showCountdown ? (
                        <>
                          <span className="text-[18px] font-bold leading-none text-white [text-shadow:0_0_6px_#000,0_0_3px_#000]">
                            {total} reps
                          </span>
                          <span className="mt-1 text-[18px] font-bold leading-none text-white [text-shadow:0_0_6px_#000,0_0_3px_#000]">
                            in {countdown}…
                          </span>
                        </>
                      ) : (
                        <span className="text-[22px] font-bold leading-none text-white [text-shadow:0_0_6px_#000,0_0_3px_#000]">
                          {phase?.phase === 'rep' ? `${total - phase.completedReps}/${total}` : `${total}/${total}`}
                        </span>
                      )}
                    </div>
                  </div>
                )
              })()}
              {currentStep?.weight && (
                <div className="absolute right-4 top-4 z-10 flex flex-col items-center">
                  <div className="relative">
                    <img
                      src={withBaseUrl('weight_icon.webp')}
                      alt="weight"
                      className="h-24 w-24 rounded bg-yellow-300 p-1"
                    />
                    <span className="absolute inset-0 flex items-center justify-center text-[22px] font-bold leading-none text-white [text-shadow:0_0_6px_#000,0_0_3px_#000]">
                      {currentStep.weight}
                    </span>
                  </div>
                </div>
              )}
              {!currentMedia?.image && !currentMedia?.video && (
                <p className="text-sm text-gray-600">No media for this exercise.</p>
              )}

              {currentMedia?.video && !mediaMissing && (
                <video
                  controls
                  className="h-full max-h-full w-full rounded border border-gray-200 object-contain"
                  src={currentMedia.video}
                  style={mediaTransformStyle}
                  onError={() => setMediaMissing(true)}
                  data-cy="exercise-video"
                />
              )}

              {!currentMedia?.video && currentMedia?.image && !mediaMissing && (
                <img
                  className="h-full max-h-full w-full rounded border border-gray-200 object-contain"
                  src={currentMedia.image}
                  alt={currentStepDisplayName}
                  style={mediaTransformStyle}
                  onError={() => setMediaMissing(true)}
                  data-cy="exercise-image"
                />
              )}

              {mediaMissing && (
                <p className="text-sm text-amber-700">Media file is missing.</p>
              )}
            </div>
          )}

          {completed && (
            <div
              className="rounded border border-green-400 bg-green-50 p-4 font-medium text-green-700"
              data-cy="workout-completed"
            >
              Workout completed. Great job!
            </div>
          )}

          {!completed && nextStep && (
            <div className="shrink-0 rounded border border-gray-200 bg-gray-50 px-3 py-2 text-sm text-gray-500" data-cy="next-step-preview">
              <span className="mr-1.5 font-medium uppercase tracking-wide text-gray-400 text-xs">Next:</span>
              <span className="text-gray-700 font-medium">{nextStepDisplayName}</span>
              {(nextStep.reps || nextStep.weight) && (
                <span className="ml-2 text-gray-500">
                  {nextStep.reps && `${nextStep.reps.reps_num} reps`}
                  {nextStep.reps && nextStep.weight && ' × '}
                  {nextStep.weight && nextStep.weight}
                </span>
              )}
            </div>
          )}
        </>
      ) : (
        <div className="flex min-h-0 flex-1 flex-col gap-3 overflow-hidden rounded border border-gray-300 bg-white p-3" data-cy="workout-preview-view">
          <h2 className="text-lg font-semibold">Workout Preview</h2>
          <div className="flex-1 overflow-y-auto space-y-1 pr-1">
            {selectedWorkout.plan.map((step, index) => {
              const isCurrent = index === currentStepIndex
              const isRest = step.id === 'rest'
              const colors = isRest ? REST_COLOR : SEGMENT_COLORS[step.colorIndex ?? 0]
              const media = catalog[step.id]
              const displayName = media?.display_name
                ? (step.label ? `${media.display_name} (${step.label})` : media.display_name)
                : (step.id ?? 'N/A')

              return (
                <div
                  key={index}
                  style={{ backgroundColor: colors.light }}
                  className={`relative rounded border-l-4 p-3 transition-all ${isCurrent ? 'border-blue-600 ring-2 ring-blue-600 ring-inset' : 'border-transparent'
                    }`}
                  onClick={() => jumpToStep(index)}
                  role="button"
                  tabIndex={0}
                >
                  <div className="flex items-center justify-between">
                    <div className="flex flex-1 flex-col">
                      <span className={`font-medium ${isCurrent ? 'text-blue-700' : 'text-gray-800'}`}>
                        {index + 1}. {displayName}
                      </span>
                      {step.weight && (
                        <span className="text-xs text-gray-500 font-medium">
                          Weight: {step.weight}
                        </span>
                      )}
                    </div>
                    <div className="text-sm font-medium text-gray-600">
                      {step.reps ? `${step.reps.reps_num} reps` : formatClock(step.duration_s)}
                    </div>
                  </div>
                </div>
              )
            })}
          </div>
        </div>
      )}
    </main>
  )
}

function App() {
  const workouts = useMemo(() => parseWorkouts(), [])
  const catalog = useMemo(() => parseCatalog(), [])
  const catalogItems = useMemo(() => parseCatalogWithSections(), [])

  return (
    <Routes>
      <Route path="/" element={
        <div className="mx-auto min-h-screen w-full max-w-4xl p-4 sm:p-6">
          <MenuPage workouts={workouts} />
        </div>
      } />
      <Route path="/catalog" element={
        <div className="mx-auto min-h-screen w-full max-w-screen-2xl p-4 sm:p-6">
          <CatalogView items={catalogItems} workouts={workouts} />
        </div>
      } />
      <Route path="/workout/:workoutId" element={
        <div className="mx-auto min-h-screen w-full max-w-4xl p-4 sm:p-6">
          <WorkoutPage workouts={workouts} catalog={catalog} />
        </div>
      } />
      <Route path="*" element={<Navigate to="/" replace />} />
    </Routes>
  )
}

export default App

