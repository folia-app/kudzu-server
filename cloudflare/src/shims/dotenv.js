// dotenv reads .env off disk. A Worker has no disk, and the values it would
// have loaded are provided as bindings instead, so loading is a no-op.
export function config () { return { parsed: {} } }
export default { config }
