export interface InfoboxDefinition {
  match: (url: URL) => boolean
  cssClasses: string | string[]
  injectStyles?: string
}
