// State contract of the Milestone Claude Code pane.
export type TaskView = {
  key: string
  icon: string
  title: string
  state: string
  isCurrent: boolean
  isFinished: boolean
  acceptance: string
  notes: string[]
}

export type GoalView = {
  key: string
  id: number
  title: string
  state: string
  details: string[]
  tasks: TaskView[]
}

export type PanelView = {
  projectName: string
  current: (GoalView & { label: string }) | null
  emptyTitle: string
  emptyHint: string
  progress: { done: number; total: number; text: string } | null
  reason: string
  others: GoalView[]
  archive: { summary: string; goals: GoalView[] }
  errors: string[]
}

/** What the pane shows: the last view read, and how the pane stays current. */
export type PaneState = {
  view: PanelView | null
  /** 'live' while file events arrive, 'reading', or 'error' with `message`. */
  sync: 'live' | 'reading' | 'error'
  message: string
}

declare module 'claude-code' {
  interface PluginState {
    milestone: {
      pane: Shaped<PaneState>
      expanded: Shaped<Record<string, boolean>>
    }
  }
}
