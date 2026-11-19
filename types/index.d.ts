export type Status = 'idea' | 'planning' | 'planned' | 'active' | 'done' | 'dropped'
export type Split = '' | 'tasks' | 'goals'
export type Mark = ' ' | '~' | 'x' | '-'

export type Task = { n: number; mark: Mark; title: string; acceptance: string }

export type Section = { heading: string; body: string }

export type Goal = {
  id: number
  title: string
  status: Status
  parent: number | null
  /** Place among its siblings; null until the sibling group is first reordered, then set on every sibling. */
  order: number | null
  split: Split
  created: string
  sections: Section[]
  tasks: Task[]
}

export type FileError = { file: string; reason: string }

export type Pool = { goals: Goal[]; errors: FileError[] }
