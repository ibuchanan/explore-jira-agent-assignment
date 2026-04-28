import { defineConfig } from "tsdown";

export default defineConfig({
  entry: {
    index: "./src/index.ts",
    actiontypes: "./src/actiontypes.ts",
    "util/errors": "./src/util/errors.ts",
  },
  format: ["esm"],
  sourcemap: true,
  target: "node20",
  deps: {
    external: ["typescript", "yaml"],
  },
});
