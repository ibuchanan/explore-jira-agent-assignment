// fallow-ignore-file unused-file
// Re-export barrel kept for developer ergonomics.
// The Forge runtime loads src/index.ts directly (not this file), so fallow
// cannot see an in-repo import path — suppress to avoid a false positive.
export { handleJsonRpc } from "./agent";
