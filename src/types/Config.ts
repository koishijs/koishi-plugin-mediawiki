import { InfoboxDefinition } from './Infobox'

export interface Config {
  cmdAuthWiki: number
  cmdAuthConnect: number
  cmdAuthSearch: number
  searchIfNotExist: false
  customInfoboxes: InfoboxDefinition[]
}
