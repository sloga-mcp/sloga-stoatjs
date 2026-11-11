/**
 * The in-app Prot purchase types (S6) match the JSON the server sends.
 *
 * These are types only, and `node --test` strips types before it runs a
 * spec, so a literal typed `ProtFeature` here would pass at run time even if
 * the type were wrong. Each case therefore runs the TypeScript checker over
 * the example bodies (from the server's routes and root advert) against
 * `src/types/prot.ts`, and asserts the exact diagnostics: none for a body the
 * server sends, and an error for a body it never sends (a camelCase key, an
 * unknown store). An older server's root advert has no `store`, so it must
 * still type-check as a `ProtFeature` and read `store` as undefined.
 *
 * Run from the package root:
 *
 *   node --test --conditions=browser test/protStore.test.ts
 *
 * To run the same cases against another `src/` tree, such as a known-bad
 * control, set `STOATJS_SRC` to its absolute path (see loadSrc.ts).
 */
import assert from "node:assert/strict";
import { test } from "node:test";
import { fileURLToPath } from "node:url";
import ts from "typescript";

import { SRC_ROOT } from "./loadSrc.ts";

type ProtFeature = import("../src/types/prot.ts").ProtFeature;
type ProtMe = import("../src/types/prot.ts").ProtMe;

/** A module that never exists on disk, beside the types it imports */
const CHECK_FILE = fileURLToPath(
  new URL("types/__protStoreCheck.ts", SRC_ROOT),
);

const OPTIONS: ts.CompilerOptions = {
  strict: true,
  noEmit: true,
  target: ts.ScriptTarget.ES2022,
  module: ts.ModuleKind.ESNext,
  moduleResolution: ts.ModuleResolutionKind.Bundler,
  lib: ["lib.es5.d.ts"],
  types: [],
  skipLibCheck: true,
};

/** Parsed lib and `prot.ts` files, shared between checks */
const parsed = new Map<string, ts.SourceFile | undefined>();

/**
 * The checker's diagnostics for `body`, checked as a module that imports
 * every type of `prot.ts` as `P`; `[]` when it type-checks
 */
function typeErrors(body: string): string[] {
  const source = `import type * as P from "./prot.js";\n${body}\n`;
  const host = ts.createCompilerHost(OPTIONS);
  const { fileExists, getSourceFile, readFile } = host;

  host.fileExists = (name) => name === CHECK_FILE || fileExists(name);
  host.readFile = (name) => (name === CHECK_FILE ? source : readFile(name));
  host.getSourceFile = (name, language, ...rest) => {
    if (name === CHECK_FILE) return ts.createSourceFile(name, source, language);
    if (!parsed.has(name)) {
      parsed.set(name, getSourceFile.call(host, name, language, ...rest));
    }
    return parsed.get(name);
  };

  const program = ts.createProgram([CHECK_FILE], OPTIONS, host);
  return ts.getPreEmitDiagnostics(program).map((diagnostic) => {
    const text = ts.flattenDiagnosticMessageText(diagnostic.messageText, " ");
    return `TS${diagnostic.code}: ${text}`;
  });
}

/** The error codes alone, for a body that must not type-check */
function errorCodes(body: string): string[] {
  return typeErrors(body).map((error) => error.split(":")[0]);
}

/**
 * Every required key of `P.<type>`, sorted, read from the checker's
 * "missing" diagnostics for an empty literal. TS2740 names only the first
 * four, so the named keys are supplied (as `never`) and the check repeats
 * until the literal type-checks; any other diagnostic fails the case.
 */
function requiredKeys(type: string): string[] {
  const keys: string[] = [];
  for (;;) {
    const fields = keys.map((key) => `${key}: null as never`).join(", ");
    const errors = typeErrors(`const value: P.${type} = { ${fields} };`);
    if (errors.length === 0) return keys.sort();
    assert.equal(errors.length, 1, errors.join("\n"));

    const [error] = errors;
    const single = /^TS2741: Property '(\w+)' is missing in type /.exec(error);
    const many =
      /^TS27(?:39|40): Type '.*' is missing the following properties from type '\w+': ([\w, ]+?)(?:, and \d+ more)?\.?$/.exec(
        error,
      );
    const named = single ? [single[1]] : many?.[1].split(", ");
    assert.ok(named?.length, error);
    // A key named again would loop forever
    assert.ok(!named.some((key) => keys.includes(key)), error);
    keys.push(...named);
  }
}

/** A JSON body, typed as the server's type and checked strictly */
function typed(type: string, body: unknown): string {
  return `const value: P.${type} = ${JSON.stringify(body, null, 2)};`;
}

/** `features.prot` from a server with fuel tanks but before in-app packs */
const TANK_ERA_ADVERT = `{
  "enabled": true,
  "self_serve_enabled": false,
  "sales_open": true,
  "cipher_grants_enabled": true,
  "packs": [
    { "id": "p5", "cents": 500, "prot": 500 },
    { "id": "p25", "cents": 2500, "prot": 2600 }
  ],
  "exact_min_cents": 50,
  "exact_max_cents": 50000,
  "wallet_cap": 100000,
  "tank": {
    "channel_daily_cost": { "10": 40, "25": 90, "50": 160, "100": 280 },
    "min_contribution": 50,
    "min_launch_goal_days": 30,
    "max_launch_goal_days": 365,
    "launch_goal_deadline_days": 30,
    "withdraw_cutoff_hours": 48,
    "contribute_hold_hours": 72,
    "grace_days": 5,
    "freeze_days": 25,
    "deletion_enabled": false
  }
}`;

/** `features.prot` from a server before fuel tanks too */
const WALLET_ERA_ADVERT = `{
  "enabled": true,
  "self_serve_enabled": true,
  "sales_open": false,
  "cipher_grants_enabled": false,
  "packs": [],
  "exact_min_cents": 0,
  "exact_max_cents": 0,
  "wallet_cap": 100000
}`;

const PRODUCTS = [
  { store: "apple", product_id: "gg.sloga.prot.p5", prot: 500 },
  { store: "apple", product_id: "gg.sloga.prot.p10", prot: 1000 },
  { store: "apple", product_id: "gg.sloga.prot.p25", prot: 2600 },
  { store: "apple", product_id: "gg.sloga.prot.p50", prot: 5300 },
  { store: "apple", product_id: "gg.sloga.prot.p100", prot: 11000 },
  { store: "play", product_id: "gg.sloga.prot.p5", prot: 500 },
  { store: "play", product_id: "gg.sloga.prot.p10", prot: 1000 },
  { store: "play", product_id: "gg.sloga.prot.p25", prot: 2600 },
  { store: "play", product_id: "gg.sloga.prot.p50", prot: 5300 },
  { store: "play", product_id: "gg.sloga.prot.p100", prot: 11000 },
];

/** `features.prot.store` as the test node advertises it (no credentials) */
const STORE = {
  apple_open: false,
  play_open: false,
  products: PRODUCTS,
  us_web_link: false,
};

/** JSON in, JSON out: what the client holds is what the server sent */
function roundTrip<T>(body: T): T {
  const read = JSON.parse(JSON.stringify(body)) as T;
  assert.deepEqual(read, body);
  return read;
}

test("the type check itself refuses a body the server never sends", () => {
  // Without this, a checker that saw nothing would pass every case below
  assert.deepEqual(errorCodes(`const store: P.ProtStore = "google";`), [
    "TS2322",
  ]);
  assert.deepEqual(
    errorCodes(`const store: P.ProtStoreFeature = { apple_open: true };`),
    ["TS2739"],
  );
  assert.deepEqual(errorCodes(`const missing: P.NoSuchType = 1;`), ["TS2694"]);
});

test("every key the server always sends is required, and no other", () => {
  // Exact sets: a required key drifting to optional (or back) fails here
  const expected: Record<string, string[]> = {
    ProtStoreFeature: ["apple_open", "play_open", "products", "us_web_link"],
    ProtStoreProductView: ["product_id", "prot", "store"],
    DataProtStoreIntent: ["product_id", "store"],
    ProtStoreIntentResponse: [
      "expires_at",
      "intent_id",
      "product_id",
      "prot",
      "token",
    ],
    DataProtStoreVerify: ["store"],
    ProtStoreVerifyResponse: ["status"],
  };

  for (const [type, keys] of Object.entries(expected)) {
    assert.deepEqual(requiredKeys(type), keys, type);
  }
});

test("older_server_advert_without_store_parses", () => {
  for (const advert of [TANK_ERA_ADVERT, WALLET_ERA_ADVERT]) {
    assert.deepEqual(
      typeErrors(
        `const feature: P.ProtFeature = ${advert};\n` +
          `const store: P.ProtStoreFeature | null = feature.store ?? null;`,
      ),
      [],
    );

    const feature: ProtFeature = JSON.parse(advert);
    assert.equal(feature.store, undefined);
    assert.equal("store" in feature, false);
    assert.equal(feature.store ?? null, null);
  }
});

test("a current advert carries the store packs", () => {
  const advert = JSON.stringify({
    ...JSON.parse(TANK_ERA_ADVERT),
    store: STORE,
  });

  assert.deepEqual(typeErrors(`const feature: P.ProtFeature = ${advert};`), []);

  const feature: ProtFeature = JSON.parse(advert);
  assert.deepEqual(feature.store, STORE);
  assert.deepEqual(Object.keys(feature.store ?? {}), [
    "apple_open",
    "play_open",
    "products",
    "us_web_link",
  ]);

  // An open store with no products and the web-link flag on
  assert.deepEqual(
    typeErrors(
      typed("ProtStoreFeature", {
        apple_open: true,
        play_open: true,
        products: [],
        us_web_link: true,
      }),
    ),
    [],
  );
});

test("a store product is the store, its id and the Prot it credits", () => {
  for (const product of PRODUCTS) {
    assert.deepEqual(typeErrors(typed("ProtStoreProductView", product)), []);
    assert.deepEqual(Object.keys(roundTrip(product)), [
      "store",
      "product_id",
      "prot",
    ]);
  }

  assert.deepEqual(
    errorCodes(
      typed("ProtStoreProductView", {
        store: "google",
        product_id: "gg.sloga.prot.p5",
        prot: 500,
      }),
    ),
    ["TS2322"],
  );
  assert.deepEqual(
    errorCodes(
      typed("ProtStoreProductView", {
        store: "play",
        productId: "gg.sloga.prot.p5",
        prot: 500,
      }),
    ),
    ["TS2353"],
  );
});

test("the intent body and its answer are snake_case", () => {
  const body = { store: "play", product_id: "gg.sloga.prot.p10" };
  assert.deepEqual(typeErrors(typed("DataProtStoreIntent", body)), []);
  assert.deepEqual(roundTrip(body), body);
  assert.deepEqual(
    errorCodes(
      typed("DataProtStoreIntent", {
        store: "apple",
        productId: "gg.sloga.prot.p10",
      }),
    ),
    ["TS2353"],
  );
  assert.deepEqual(
    errorCodes(typed("DataProtStoreIntent", { store: "apple" })),
    ["TS2741"],
  );

  const apple = {
    intent_id: "01JC4ZC0X0W1V2T3S4R5Q6P7N8",
    token: "3f1c2a9e-5b7d-4e8f-9a0b-1c2d3e4f5a6b",
    prot: 1000,
    product_id: "gg.sloga.prot.p10",
    expires_at: 1_800_000_900_000,
  };
  const play = {
    ...apple,
    token: "q83vEjRWeJq83vEjRWeJq83vEjRWeJq83vEjRWeJq83",
    prot: 11000,
    product_id: "gg.sloga.prot.p100",
  };
  for (const answer of [apple, play]) {
    assert.deepEqual(typeErrors(typed("ProtStoreIntentResponse", answer)), []);
    assert.deepEqual(Object.keys(roundTrip(answer)), [
      "intent_id",
      "token",
      "prot",
      "product_id",
      "expires_at",
    ]);
  }
  assert.equal(play.token.length, 43);
  assert.deepEqual(
    errorCodes(
      typed("ProtStoreIntentResponse", {
        intentId: apple.intent_id,
        token: apple.token,
        prot: 1000,
        product_id: "gg.sloga.prot.p10",
        expires_at: apple.expires_at,
      }),
    ),
    ["TS2353"],
  );
});

test("the verify body is the Apple transaction or the Play token", () => {
  const apple = { store: "apple", signed_transaction: "a.b.c" };
  const play = {
    store: "play",
    product_id: "gg.sloga.prot.p5",
    purchase_token: "t",
  };
  for (const body of [apple, play]) {
    assert.deepEqual(typeErrors(typed("DataProtStoreVerify", body)), []);
    assert.deepEqual(roundTrip(body), body);
  }

  // The server reads every field but `store` as optional (and refuses a body
  // missing what its store needs), so the type does too
  assert.deepEqual(
    typeErrors(typed("DataProtStoreVerify", { store: "play" })),
    [],
  );
  assert.deepEqual(
    errorCodes(
      typed("DataProtStoreVerify", {
        store: "apple",
        signedTransaction: "a.b.c",
      }),
    ),
    ["TS2353"],
  );
  assert.deepEqual(
    errorCodes(typed("DataProtStoreVerify", { signed_transaction: "a.b.c" })),
    ["TS2741"],
  );
});

test("a verify answer carries only the keys the server sent", () => {
  const credited = {
    status: "credited",
    purchase_id: "apple:prod:2000000123456789",
    balance: 1500,
    ledger_id: "01JC4ZD8M2K3J4H5G6F7E8D9C0",
  };
  const already = {
    ...credited,
    status: "already_credited",
    purchase_id: `play:${"ab".repeat(32)}`,
  };
  const pending = { status: "pending", purchase_id: "play:" + "cd".repeat(32) };
  const bare = { status: "pending" };

  for (const answer of [credited, already, pending, bare]) {
    assert.deepEqual(typeErrors(typed("ProtStoreVerifyResponse", answer)), []);
    assert.deepEqual(roundTrip(answer), answer);
  }
  assert.equal("reason" in credited, false);

  for (const reason of [
    "test",
    "unbound",
    "refunded",
    "unknown_product",
    "wrong_account",
    "no_buyer",
  ]) {
    const rejected = { status: "rejected", reason };
    assert.deepEqual(
      typeErrors(typed("ProtStoreVerifyResponse", rejected)),
      [],
    );
  }

  assert.deepEqual(
    errorCodes(typed("ProtStoreVerifyResponse", { status: "failed" })),
    ["TS2322"],
  );
  // TS2820: not assignable, with the "did you mean" of the snake_case reason
  assert.deepEqual(
    errorCodes(
      typed("ProtStoreVerifyResponse", {
        status: "rejected",
        reason: "wrongAccount",
      }),
    ),
    ["TS2820"],
  );
  assert.deepEqual(
    errorCodes(
      typed("ProtStoreVerifyResponse", {
        status: "credited",
        ledgerId: "01JC4ZD8M2K3J4H5G6F7E8D9C0",
      }),
    ),
    ["TS2353"],
  );
});

test("/@me sends store_preview only when true", () => {
  const me: ProtMe = {
    balance: 1500,
    held: 1000,
    version: 4,
    recent: [
      {
        id: "01JC4ZD8M2K3J4H5G6F7E8D9C0",
        kind: "Purchase",
        amount: 1000,
        created_at: 1_800_000_000_000,
        order_id: "apple:prod:2000000123456789",
      },
    ],
  };
  const preview: ProtMe = { ...me, store_preview: true };

  // Omitted when false, and by servers older than in-app purchases
  assert.deepEqual(typeErrors(typed("ProtMe", me)), []);
  const read = roundTrip(me);
  assert.equal(read.store_preview, undefined);
  assert.equal(read.store_preview === true, false);

  assert.deepEqual(typeErrors(typed("ProtMe", preview)), []);
  assert.equal(roundTrip(preview).store_preview, true);

  assert.deepEqual(
    errorCodes(typed("ProtMe", { ...me, store_preview: "yes" })),
    ["TS2322"],
  );
  assert.deepEqual(errorCodes(typed("ProtMe", { ...me, storePreview: true })), [
    "TS2353",
  ]);
});
