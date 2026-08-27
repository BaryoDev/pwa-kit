import { defineConfig } from "tsup";

export default defineConfig({
  entry: ["src/index.ts", "src/report.ts"],
  format: ["esm", "cjs"],
  dts: true,
  clean: true,
  // Self-contained entries. The /report entry is meant to be droppable into a site with no
  // bundler, served as a plain <script type="module">, so it must not need a sibling chunk.
  splitting: false,
  sourcemap: true,
  external: ["react"],
  outExtension({ format }) {
    return { js: format === "cjs" ? ".cjs" : ".js" };
  },
});
