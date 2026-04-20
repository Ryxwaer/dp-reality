// src/module.ts
var EMPTY_CONFIG = {
  listing_type: "",
  property_sub: "",
  search_text: "",
  psc: "",
  min_price: null,
  max_price: null
};
var LISTING_TYPE_TO_MAIN = {
  sale: "prodam",
  rent: "pronajmu"
};
var BAZOS_PATH_PRICE = {
  prodam: "sale",
  pronajmu: "rent",
  pronajem: "rent"
};
var PROPERTY_SUBS = [
  "",
  "byt",
  "dum",
  "pozemek",
  "nebytove-prostory",
  "kancelar",
  "sklad",
  "obchod",
  "garaz",
  "chata",
  "chalupa",
  "ostatni"
];
var BAZOS_PATH_SUBCAT = new Set(PROPERTY_SUBS.filter(Boolean));
var KNOWN_PARAMS = /* @__PURE__ */ new Set(["hledat", "hlokalita", "cenaod", "cenado"]);
function parseBazosUrl(raw) {
  const out = { ok: false, patch: {}, summary: [], ignored: [] };
  let url;
  try {
    url = new URL(raw.trim());
  } catch {
    return { ...out, error: "Not a valid URL" };
  }
  if (!url.hostname.endsWith("bazos.cz")) {
    return { ...out, error: "URL must be from bazos.cz" };
  }
  const segments = url.pathname.split("/").filter(Boolean);
  const main = segments[0];
  const sub = segments[1];
  const priceType = main ? BAZOS_PATH_PRICE[main] : void 0;
  if (priceType) {
    out.patch.listing_type = priceType;
    out.summary.push({ label: "Listing type", value: priceType });
  }
  if (sub && BAZOS_PATH_SUBCAT.has(sub)) {
    out.patch.property_sub = sub;
    out.summary.push({ label: "Subcategory", value: sub });
  }
  const hledat = url.searchParams.get("hledat");
  if (hledat && hledat.trim()) {
    out.patch.search_text = hledat.trim();
    out.summary.push({ label: "Search text (in description)", value: hledat.trim() });
  }
  const psc = url.searchParams.get("hlokalita");
  if (psc && /^\d{5}$/.test(psc)) {
    out.patch.psc = psc;
    out.summary.push({ label: "Postal code", value: psc });
  }
  const cenaod = url.searchParams.get("cenaod");
  if (cenaod) {
    const n = Number(cenaod);
    if (Number.isFinite(n) && n > 0) {
      out.patch.min_price = n;
      out.summary.push({ label: "Min price", value: `${n.toLocaleString("cs-CZ")} CZK` });
    }
  }
  const cenado = url.searchParams.get("cenado");
  if (cenado) {
    const n = Number(cenado);
    if (Number.isFinite(n) && n > 0) {
      out.patch.max_price = n;
      out.summary.push({ label: "Max price", value: `${n.toLocaleString("cs-CZ")} CZK` });
    }
  }
  for (const [k] of url.searchParams) {
    if (!KNOWN_PARAMS.has(k) && out.ignored.indexOf(k) === -1) {
      out.ignored.push(k);
    }
  }
  out.ok = true;
  return out;
}
function compileMatcher(config) {
  const filters = [];
  if (config.listing_type) {
    filters.push({ field: "price_type", op: "eq", value: config.listing_type });
    filters.push({ field: "category_main", op: "eq", value: LISTING_TYPE_TO_MAIN[config.listing_type] });
  }
  if (config.property_sub) {
    filters.push({ field: "category_sub", op: "eq", value: config.property_sub });
  }
  const text = (config.search_text ?? "").trim();
  if (text) {
    filters.push({ field: "description", op: "contains", value: text, ci: true });
  }
  const psc = (config.psc ?? "").trim();
  if (/^\d{5}$/.test(psc)) {
    filters.push({ field: "psc", op: "eq", value: psc });
  }
  if (typeof config.min_price === "number" && config.min_price > 0) {
    filters.push({ field: "price", op: "gte", value: config.min_price });
  }
  if (typeof config.max_price === "number" && config.max_price > 0) {
    filters.push({ field: "price", op: "lte", value: config.max_price });
  }
  return { filters };
}
function normalizeConfig(raw) {
  const cfg = { ...EMPTY_CONFIG, ...raw };
  if (!PROPERTY_SUBS.includes(cfg.property_sub)) cfg.property_sub = "";
  if (cfg.listing_type !== "sale" && cfg.listing_type !== "rent") cfg.listing_type = "";
  cfg.search_text = (cfg.search_text ?? "").toString();
  cfg.psc = (cfg.psc ?? "").toString();
  cfg.min_price = typeof cfg.min_price === "number" && Number.isFinite(cfg.min_price) ? cfg.min_price : null;
  cfg.max_price = typeof cfg.max_price === "number" && Number.isFinite(cfg.max_price) ? cfg.max_price : null;
  return cfg;
}
var manifest = {
  name: "Bazos",
  collection: "bazos",
  source: "bazos",
  description: `# Bazos module

Configure a search over **reality.bazos.cz** \u2014 the bot will email you
whenever a new listing matches the filters you pick.

## How it works

Every filter axis is its own form field (listing type, category,
search text, postal code, price). You can also paste a bazos.cz URL
and click **Prefill from URL** \u2014 the module parses the URL and
replaces every field from it (one-shot convert). The URL itself is
not saved.

URL parsing covers:

| Source                    | Populates                                        |
|---------------------------|--------------------------------------------------|
| \`/<prodam|pronajem>/\`   | listing type                                     |
| \`/<byt|dum|\u2026>/\`         | category                                         |
| \`hledat\`                | search text (description contains)               |
| \`hlokalita\`             | postal code (exact match)                        |
| \`cenaod\` / \`cenado\`   | min / max price                                  |
| \`humkreis\`              | **ignored** \u2014 bazos has no coordinates on listings |

## Data shape

Each match in the \`bazos\` collection stores:
- \`title\`, \`description\` (teaser from the list page), \`price\`, \`price_type\`
- \`psc\`, \`city\`, \`locality_raw\`
- \`category_main\`, \`category_sub\`, \`property_type\`
- \`url\`

No disposition field \u2014 Bazos list pages don't expose a structured
disposition column. Filter on \`title\` contains instead if you want
\`2+kk\` matches.
`,
  configSchema: {
    type: "object",
    additionalProperties: false,
    properties: {
      listing_type: { type: "string", enum: ["", "sale", "rent"] },
      property_sub: {
        type: "string",
        enum: [
          "",
          "byt",
          "dum",
          "pozemek",
          "nebytove-prostory",
          "kancelar",
          "sklad",
          "obchod",
          "garaz",
          "chata",
          "chalupa",
          "ostatni"
        ]
      },
      search_text: { type: "string", maxLength: 200 },
      psc: { type: "string", pattern: "^(\\d{5})?$" },
      min_price: { type: ["number", "null"], minimum: 0 },
      max_price: { type: ["number", "null"], minimum: 0 }
    }
  },
  notification: {
    subject: "Bazos: {{count}} new listings",
    title: "title",
    url: "url",
    fields: [
      { label: "Price", value: "{{ price }} CZK ({{ price_type }})" },
      { label: "Location", value: "{{ city }} {{ psc }}" },
      { label: "Description", value: "{{ description }}" }
    ]
  }
};
var factory = ({ h, ref, reactive, computed, saveBot, existingBot }) => {
  const initial = normalizeConfig(existingBot?.config ?? {});
  const name = ref(existingBot?.name ?? "Bazos bot");
  const active = ref(existingBot?.active ?? true);
  const cfg = reactive({ ...initial });
  const prefillUrl = ref("");
  const prefillError = ref(null);
  const lastPrefill = ref(null);
  const submitting = ref(false);
  const errorMessage = ref(null);
  const livePreview = computed(() => {
    const raw = prefillUrl.value.trim();
    if (!raw) return null;
    return parseBazosUrl(raw);
  });
  const compiled = computed(() => compileMatcher(cfg));
  const canSave = computed(() => compiled.value.filters.length > 0);
  function applyPrefill() {
    prefillError.value = null;
    const preview = livePreview.value;
    if (!preview) {
      prefillError.value = "Paste a URL first.";
      return;
    }
    if (!preview.ok) {
      prefillError.value = preview.error ?? "Invalid URL";
      return;
    }
    Object.assign(cfg, EMPTY_CONFIG, preview.patch);
    lastPrefill.value = { summary: preview.summary, ignored: preview.ignored };
  }
  function onPrefillInput(e) {
    prefillUrl.value = e.target.value;
    prefillError.value = null;
  }
  async function onSubmit(e) {
    e.preventDefault();
    errorMessage.value = null;
    if (!canSave.value) {
      errorMessage.value = "Pick at least one filter \u2014 listing type, price, postal code, or search text.";
      return;
    }
    submitting.value = true;
    try {
      await saveBot({
        name: name.value.trim() || "Bazos bot",
        active: active.value,
        config: { ...cfg },
        matcher: compiled.value
      });
    } catch (err) {
      const e2 = err;
      errorMessage.value = e2.data?.message ?? e2.message ?? "Failed to save bot";
    } finally {
      submitting.value = false;
    }
  }
  const labelCls = "block text-sm font-medium mb-1";
  const inputCls = "w-full rounded-md border border-default bg-default px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-primary";
  const hintCls = "text-xs text-muted";
  const sectionCls = "rounded-md border border-default bg-elevated/30 p-4 flex flex-col gap-3";
  function selectOption(value, label, current) {
    return h("option", { value, selected: value === current }, label);
  }
  function renderPrefillPreview() {
    if (prefillError.value) {
      return h("p", { class: "text-sm text-error" }, prefillError.value);
    }
    const p = livePreview.value;
    if (!p) {
      return h(
        "p",
        { class: hintCls },
        'Optional: paste a reality.bazos.cz search URL, then click "Prefill" to fill the fields below from it.'
      );
    }
    if (!p.ok) {
      return h("p", { class: "text-sm text-error" }, p.error ?? "Invalid URL");
    }
    const keys = Object.keys(p.patch);
    if (keys.length === 0) {
      return h(
        "p",
        { class: "text-sm text-warning" },
        "URL parsed but produced no fields. Add e.g. a price range, postal code, or search text on bazos."
      );
    }
    return h("div", { class: "flex flex-col gap-1" }, [
      h("p", { class: "text-xs font-medium uppercase tracking-wide text-muted" }, "URL will set"),
      h(
        "ul",
        { class: "flex flex-col gap-1 text-sm" },
        p.summary.map((s) => h("li", { class: "flex gap-2" }, [
          h("span", { class: "text-muted min-w-40" }, s.label),
          h("span", { class: "font-medium" }, s.value)
        ]))
      ),
      p.ignored.length > 0 ? h(
        "p",
        { class: "text-xs text-muted pt-1" },
        `Ignored params: ${p.ignored.join(", ")} \u2014 humkreis (radius) is not supported on bazos.`
      ) : null
    ]);
  }
  function renderMatcherPreview() {
    const filters = compiled.value.filters;
    if (filters.length === 0) {
      return h(
        "p",
        { class: "text-sm text-warning" },
        "No filters active \u2014 the bot would match every new bazos listing. Set at least one field."
      );
    }
    return h("div", { class: "flex flex-col gap-1" }, [
      h("p", { class: "text-xs font-medium uppercase tracking-wide text-muted" }, `Matcher (${filters.length} filter${filters.length === 1 ? "" : "s"})`),
      h(
        "ul",
        { class: "flex flex-col gap-1 text-sm font-mono" },
        filters.map((f) => h(
          "li",
          {},
          `${f.field} ${f.op} ${JSON.stringify(f.value)}${f.ci ? "  (ci)" : ""}`
        ))
      )
    ]);
  }
  return {
    setup() {
      return () => h("form", {
        class: "flex flex-col gap-6 max-w-2xl",
        onSubmit
      }, [
        h("div", {}, [
          h("label", { class: labelCls, for: "bazos-name" }, "Bot name"),
          h("input", {
            id: "bazos-name",
            class: inputCls,
            value: name.value,
            onInput: (e) => {
              name.value = e.target.value;
            }
          })
        ]),
        h("label", { class: "inline-flex items-center gap-2 text-sm" }, [
          h("input", {
            type: "checkbox",
            checked: active.value,
            onChange: (e) => {
              active.value = e.target.checked;
            }
          }),
          "Active"
        ]),
        h("div", { class: sectionCls }, [
          h("label", { class: labelCls, for: "bazos-prefill" }, "Prefill from URL (optional)"),
          h("div", { class: "flex gap-2" }, [
            h("input", {
              id: "bazos-prefill",
              class: inputCls,
              placeholder: "https://reality.bazos.cz/prodam/byt/?hledat=1%2Bkk&hlokalita=60200&cenado=5000000",
              value: prefillUrl.value,
              onInput: onPrefillInput
            }),
            h("button", {
              type: "button",
              class: "rounded-md border border-default px-3 py-2 text-sm font-medium hover:bg-elevated disabled:opacity-50",
              disabled: !livePreview.value || !livePreview.value.ok,
              onClick: applyPrefill
            }, "Prefill")
          ]),
          renderPrefillPreview()
        ]),
        h("div", { class: "grid grid-cols-1 sm:grid-cols-2 gap-4" }, [
          h("div", {}, [
            h("label", { class: labelCls, for: "bazos-listing" }, "Listing type"),
            h("select", {
              id: "bazos-listing",
              class: inputCls,
              onChange: (e) => {
                cfg.listing_type = e.target.value;
              }
            }, [
              selectOption("", "Any", cfg.listing_type),
              selectOption("sale", "Sale", cfg.listing_type),
              selectOption("rent", "Rent", cfg.listing_type)
            ])
          ]),
          h("div", {}, [
            h("label", { class: labelCls, for: "bazos-sub" }, "Category"),
            h("select", {
              id: "bazos-sub",
              class: inputCls,
              onChange: (e) => {
                cfg.property_sub = e.target.value;
              }
            }, [
              selectOption("", "Any", cfg.property_sub),
              ...PROPERTY_SUBS.filter(Boolean).map((s) => selectOption(s, s, cfg.property_sub))
            ])
          ])
        ]),
        h("div", {}, [
          h("label", { class: labelCls, for: "bazos-text" }, "Search text (matched in description)"),
          h("input", {
            id: "bazos-text",
            class: inputCls,
            placeholder: "e.g. 1+kk, balkon, novostavba",
            value: cfg.search_text,
            onInput: (e) => {
              cfg.search_text = e.target.value;
            }
          }),
          h("p", { class: hintCls }, "Case-insensitive substring match against each listing's description teaser.")
        ]),
        h("div", { class: "grid grid-cols-1 sm:grid-cols-3 gap-4" }, [
          h("div", {}, [
            h("label", { class: labelCls, for: "bazos-psc" }, "Postal code"),
            h("input", {
              id: "bazos-psc",
              class: inputCls,
              maxlength: 5,
              pattern: "\\d{5}",
              placeholder: "60200",
              value: cfg.psc,
              onInput: (e) => {
                cfg.psc = e.target.value.replace(/\D/g, "").slice(0, 5);
              }
            })
          ]),
          h("div", {}, [
            h("label", { class: labelCls, for: "bazos-min" }, "Min price (CZK)"),
            h("input", {
              id: "bazos-min",
              class: inputCls,
              type: "number",
              min: 0,
              step: 1e3,
              value: cfg.min_price ?? "",
              onInput: (e) => {
                const v = e.target.value;
                cfg.min_price = v === "" ? null : Number(v);
              }
            })
          ]),
          h("div", {}, [
            h("label", { class: labelCls, for: "bazos-max" }, "Max price (CZK)"),
            h("input", {
              id: "bazos-max",
              class: inputCls,
              type: "number",
              min: 0,
              step: 1e3,
              value: cfg.max_price ?? "",
              onInput: (e) => {
                const v = e.target.value;
                cfg.max_price = v === "" ? null : Number(v);
              }
            })
          ])
        ]),
        h("div", { class: sectionCls }, [renderMatcherPreview()]),
        errorMessage.value ? h("p", { class: "text-sm text-error" }, errorMessage.value) : null,
        h("div", { class: "flex items-center gap-2 pt-2 border-t border-default" }, [
          h("button", {
            type: "submit",
            class: "rounded-md bg-primary px-4 py-2 text-sm font-medium text-primary-foreground hover:bg-primary/90 disabled:opacity-50",
            disabled: submitting.value || !canSave.value
          }, submitting.value ? "Saving\u2026" : existingBot ? "Save changes" : "Create bot")
        ])
      ]);
    }
  };
};
var module_default = factory;
export {
  module_default as default,
  manifest
};
