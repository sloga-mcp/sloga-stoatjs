/**
 * Loads stoat.js `src/` straight into `node --test`, without building `lib/`.
 *
 * Node's type stripping cannot load `src/` as written: relative imports name
 * `./X.js` while the file on disk is `X.ts`, several modules declare enums, and
 * some type names are imported as values (`Accessor` from solid-js). These hooks
 * rewrite `./X.js` to `./X.ts` for imports made from inside `src/`, and compile
 * each `src/` file with `ts.transpileModule`, which drops the type-only imports.
 *
 * Specs load `src/` only through `loadSrc`, never with a static import: static
 * imports are linked before this module runs, so the hooks would not see them.
 *
 *   import { loadSrc } from "./loadSrc.ts";
 *   const { Client } =
 *     await loadSrc<typeof import("../src/Client.ts")>("Client.ts");
 *   const { handleEvent } = await loadSrc("events/v1.ts");
 *
 * Run with `node --test --conditions=browser test/<name>.test.ts`.
 *
 * Set `STOATJS_SRC` to an absolute `src/` directory to run the same specs
 * against another tree, such as a known-bad control exported from an older
 * commit. That tree needs its own `node_modules` (a symlink to this one is
 * enough) so bare imports such as solid-js resolve to the same instance.
 */
import { existsSync, readFileSync, realpathSync } from "node:fs";
import { registerHooks } from "node:module";
import { fileURLToPath, pathToFileURL } from "node:url";
import ts from "typescript";

function srcRoot(): URL {
  const dir = process.env.STOATJS_SRC
    ? process.env.STOATJS_SRC
    : fileURLToPath(new URL("../src/", import.meta.url));
  const real = realpathSync(dir);
  return pathToFileURL(real.endsWith("/") ? real : `${real}/`);
}

export const SRC_ROOT: URL = srcRoot();

/**
 * Import a module from `src/`, relative to `SRC_ROOT` (e.g. `"Client.ts"`).
 */
export async function loadSrc<T = Record<string, unknown>>(
  rel: string,
): Promise<T> {
  return (await import(new URL(rel, SRC_ROOT).href)) as T;
}

registerHooks({
  resolve(specifier, context, nextResolve) {
    const parent = context.parentURL;
    if (
      parent?.startsWith(SRC_ROOT.href) &&
      (specifier.startsWith("./") || specifier.startsWith("../")) &&
      specifier.endsWith(".js")
    ) {
      const rewritten = specifier.replace(/\.js$/, ".ts");
      // Hand the rewritten specifier back to Node rather than building the
      // URL here, so in-graph imports and `loadSrc` resolve to the same
      // (realpath'd) URL and no module is instantiated twice.
      if (existsSync(fileURLToPath(new URL(rewritten, parent)))) {
        return nextResolve(rewritten, context);
      }
    }

    return nextResolve(specifier, context);
  },

  load(url, context, nextLoad) {
    if (url.startsWith(SRC_ROOT.href) && url.endsWith(".ts")) {
      const fileName = fileURLToPath(url);
      const { outputText } = ts.transpileModule(
        readFileSync(fileName, "utf8"),
        {
          compilerOptions: {
            module: ts.ModuleKind.ESNext,
            target: ts.ScriptTarget.ES2022,
          },
          fileName,
        },
      );

      return { format: "module", source: outputText, shortCircuit: true };
    }

    return nextLoad(url, context);
  },
});
