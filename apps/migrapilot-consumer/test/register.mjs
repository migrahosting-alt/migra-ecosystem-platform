import { register } from 'node:module'

register('./serverOnlyLoader.mjs', import.meta.url)
