/**
 * Tag inference engine — port of marketplace.py's keyword-to-tag heuristics.
 *
 * Given a skill description (and optionally a name), infers characteristic
 * tags, default_for project types, match_language, and category.
 */

// ---------------------------------------------------------------------------
// Heuristic keyword -> tag mapping (ported from marketplace.py TAG_KEYWORDS)
// ---------------------------------------------------------------------------

const TAG_KEYWORDS: Array<[string, RegExp[]]> = [
  ['has_web', [/\bweb\b/i, /\bwebsite\b/i, /\blanding page\b/i, /\bhtml\b/i,
               /\bcss\b/i, /\bdashboard\b/i, /\bbrowser\b/i]],
  ['has_api', [/\bapi\b/i, /\brest\b/i, /\bgraphql\b/i, /\bendpoint\b/i,
               /\bopenapi\b/i, /\bgrpc\b/i, /\bwebhook\b/i]],
  ['has_mobile_ui', [/\bmobile\b/i, /\bios\b/i, /\bandroid\b/i,
                     /\bflutter\b/i, /\breact native\b/i, /\bswift\b/i,
                     /\bkotlin\b/i]],
  ['has_ui', [/\bui\b/i, /\binterface\b/i, /\bcomponent\b/i, /\bfrontend\b/i,
              /\blayout\b/i, /\bdesign\b/i, /\bvisual\b/i]],
  ['has_db', [/\bdatabase\b/i, /\bsql\b/i, /\bpostgres\b/i, /\bmysql\b/i,
              /\bmongo\b/i, /\bsqlite\b/i, /\bschema\b/i, /\bmigration\b/i]],
  ['handles_auth', [/\bauth\b/i, /\boauth\b/i, /\bjwt\b/i, /\btoken\b/i,
                    /\blogin\b/i, /\bcredential\b/i, /\bsaml\b/i]],
  ['has_user_input', [/\bform\b/i, /\binput\b/i, /\bvalidation\b/i,
                      /\buser data\b/i, /\bupload\b/i]],
  ['serves_traffic', [/\bserver\b/i, /\bhttp\b/i, /\bproduction\b/i,
                      /\bdeployment\b/i, /\btraffic\b/i]],
  ['serves_public', [/\bpublic\b/i, /\busers\b/i, /\baccessibility\b/i,
                     /\bseo\b/i, /\bmarketing\b/i]],
  ['has_docker', [/\bdocker\b/i, /\bcontainer\b/i, /\bkubernetes\b/i, /\bk8s\b/i]],
  ['has_i18n', [/\bi18n\b/i, /\bl10n\b/i, /\blocalization\b/i,
                /\binternationalization\b/i, /\btranslation\b/i, /\blocale\b/i]],
  ['has_ecommerce', [/\becommerce\b/i, /\bstripe\b/i, /\bcheckout\b/i,
                     /\bpayment\b/i, /\bshopping cart\b/i]],
  ['data_pipeline', [/\bdata pipeline\b/i, /\bjupyter\b/i, /\betl\b/i,
                     /\bml\b/i, /\bmodel training\b/i, /\bnotebook\b/i]],
  ['cli_only', [/\bcli\b/i, /\bcommand.line\b/i, /\bterminal\b/i, /\bshell tool\b/i]],
];

// Map description keywords to default_for project types.
const PROJECT_TYPE_KEYWORDS: Array<[string, RegExp[]]> = [
  ['mobile', [/\bmobile\b/i, /\bios\b/i, /\bandroid\b/i, /\bflutter\b/i,
              /\breact native\b/i]],
  ['web-frontend', [/\bfrontend\b/i, /\bwebsite\b/i, /\blanding page\b/i,
                    /\bdashboard\b/i, /\bcomponent\b/i]],
  ['backend-api', [/\bapi\b/i, /\bbackend\b/i, /\bserver\b/i, /\bmicroservice\b/i]],
  ['cli-tool', [/\bcli\b/i, /\bcommand.line\b/i, /\bterminal\b/i]],
  ['data-ml', [/\bjupyter\b/i, /\bml\b/i, /\bnotebook\b/i, /\bdata pipeline\b/i]],
];

// Language keyword -> match_language
const LANGUAGE_KEYWORDS: Array<[string, RegExp[]]> = [
  ['python', [/\bpython\b/i, /\bpep.?8\b/i, /\bdjango\b/i, /\bfastapi\b/i]],
  ['typescript', [/\btypescript\b/i, /\btsconfig\b/i]],
  ['javascript', [/\bjavascript\b/i, /\bnode\.js\b/i]],
  ['swift', [/\bswift\b/i, /\bswiftui\b/i]],
  ['kotlin', [/\bkotlin\b/i]],
  ['dart', [/\bdart\b/i, /\bflutter\b/i]],
  ['go', [/\bgolang\b/i, /\bgo 1\.\d/i]],
  ['rust', [/\brust\b/i, /\bcargo\b/i]],
  ['java', [/\bjava\b/i, /\bspring\s+boot\b/i, /\bmaven\b/i, /\bgradle\b/i]],
  ['csharp', [/\bc#\b/i, /\b\.net\b/i, /\baspnet\b/i, /\blazor\b/i]],
  ['php', [/\bphp\b/i, /\bcomposer\b/i, /\blaravel\b/i, /\bwordpress\b/i]],
  ['ruby', [/\bruby\b/i, /\brails\b/i]],
];

// Category taxonomy — ported from marketplace.py CATEGORY_KEYWORDS.
// Order matters: first matching category wins.
const CATEGORY_KEYWORDS: Array<[string, RegExp[]]> = [
  // --- Vector databases ---
  ['database/vector', [/\bpinecone\b/i, /\bweaviate\b/i, /\bqdrant\b/i, /\bchroma\s+db\b/i,
                       /\bvector\s+(?:db|database|search|store)\b/i]],
  // --- Data/ML ---
  ['data-ml/observability', [/\barize\b/i, /\bweights\s+and\s+biases\b/i, /\bwandb\b/i,
                             /\bmlflow\b/i, /\bexperiment\s+track/i, /\bllm\s+trace/i,
                             /\bmodel\s+observab/i, /\bml\s+monitor/i,
                             /\bprediction\s+log/i, /\btracing\s+(?:for\s+)?llm/i,
                             /\bml\s+experiment/i]],
  ['data-ml/llm', [/\blangchain\b/i, /\bllamaindex\b/i, /\brag\s+pipeline\b/i,
                   /\brag\b/i, /\bembedding/i,
                   /\bprompt\s+engineer/i, /\bsemantic\s+search\b/i,
                   /\bllm\s+(?:agent|chain|app)\b/i, /\bopenai\s+sdk\b/i,
                   /\banthropic\s+sdk\b/i]],
  ['data-ml/pipeline', [/\betl\s+pipeline/i, /\betl\b/i, /\bairflow\b/i,
                        /\bdagster\b/i, /\bprefect\b/i, /\bdata\s+ingestion/i,
                        /\bdata\s+pipeline/i]],
  ['data-ml/visualization', [/\bd3\.?js\b/i, /\bplotly\b/i, /\binteractive\s+(?:chart|graph|viz)/i,
                             /\bdata\s+viz/i, /\bdataviz\b/i, /\bmatplotlib\b/i,
                             /\bvisuali[sz]ation/i, /\bgraph(?:s|ing)\b/i]],
  ['data-ml/training', [/\bmodel\s+training\b/i, /\bfine.?tun/i, /\bneural\s+network\b/i,
                        /\bdataset\s+prep/i, /\bhugging\s*face\b/i]],
  // --- Cloud platforms ---
  ['cloud/aws', [/\baws\b/i, /\blambda\s+function\b/i, /\bs3\s+bucket\b/i,
                 /\bcloudformation\b/i, /\bamazon\s+web\s+service/i]],
  ['cloud/azure', [/\bazure\b/i, /\bapp\s+service\b/i, /\bcosmos\s*db\b/i,
                   /\bmicrosoft\s+cloud\b/i]],
  ['cloud/gcp', [/\bgoogle\s+cloud\b/i, /\bgcp\b/i, /\bcloud\s+run\b/i,
                 /\bbigquery\b/i, /\bfirebase\s+cloud\b/i]],
  // --- Infrastructure / DevOps ---
  ['infrastructure/iac', [/\bterraform\b/i, /\bpulumi\b/i, /\bcdk\b/i,
                          /\binfrastructure\s+as\s+code\b/i, /\biac\b/i, /\bansible\b/i]],
  ['infrastructure/docker', [/\bdocker\b/i, /\bcontainer\b/i, /\bkubernetes\b/i, /\bk8s\b/i]],
  ['infrastructure/devcontainer', [/\bdevcontainer\b/i]],
  ['infrastructure/ci', [/\bci\/?cd\b/i, /\bgithub\s+actions\b/i, /\bpipeline\b/i,
                         /\bworkflow\b/i, /\bjenkins\b/i]],
  // --- Integration / messaging ---
  ['integration/messaging', [/\bslack\s+(?:bot|integration|webhook|gif)\b/i,
                             /\bdiscord\s+bot\b/i, /\bteams\s+(?:bot|integration)\b/i,
                             /\btelegram\s+bot\b/i, /\bemail\s+(?:send|integration)/i,
                             /\bwebhook\s+integration/i]],
  // --- Database ---
  ['database', [/\bdatabase\b/i, /\bsql\b/i, /\bpostgres\b/i, /\bmysql\b/i,
                /\bfirestore\b/i, /\bmongo\b/i, /\bschema\s+migration\b/i]],
  // --- Language-specific ---
  ['language/python', [/\bpep.?8\b/i, /\bpytest\b/i, /\bpython\s+best\b/i,
                       /\bmodern\s+python\b/i, /\basyncio\b/i, /\btype\s+hints\b/i]],
  ['language/dart', [/\bdart\s+code\b/i, /\bdart\s+best\b/i, /\beffective\s+dart\b/i]],
  ['language/go', [/\bgolang\b/i, /\beffective\s+go\b/i, /\bgoroutine\b/i]],
  ['language/rust', [/\bcargo\b/i, /\bclippy\b/i, /\brust\s+ownership\b/i]],
  ['language/ruby', [/\brubocop\b/i, /\bruby\s+best\b/i]],
  ['language/php', [/\bpsr-?12\b/i, /\bphp\s+best\b/i, /\bphpstan\b/i]],
  ['language/javascript', [/\bnode\.?js\b/i, /\bjs\s+best\b/i]],
  ['language/typescript', [/\btsconfig\b/i, /\btypescript\s+strict\b/i]],
  // --- Framework-specific ---
  ['framework/flutter', [/\bflutter\s+widget\b/i, /\bwidget\s+tree\b/i, /\bflutter\s+state\b/i]],
  ['framework/react-native', [/\breact\s+native\b/i, /\bexpo\b/i, /\bflatlist\b/i]],
  ['framework/nextjs', [/\bnext\.?js\b/i, /\bapp\s+router\b/i, /\brsc\b/i]],
  ['framework/fastapi', [/\bfastapi\b/i]],
  ['framework/django', [/\bdjango\b/i, /\bdrf\b/i]],
  ['framework/wordpress', [/\bwordpress\b/i, /\bwp-/i]],
  ['framework/laravel', [/\blaravel\b/i, /\beloquent\b/i]],
  ['framework/rails', [/\brails\b/i, /\bactiverecord\b/i]],
  // --- Quality ---
  ['quality/review', [/\bcode\s+review\b/i, /\badversarial\s+review\b/i,
                      /\bedge\s+case\s+hunt\b/i, /\bcynical\s+review\b/i]],
  ['quality/testing', [/\bfuzz(?:er|ing)?\b/i, /\be2e\s+test\b/i, /\bunit\s+test\b/i,
                       /\bintegration\s+test\b/i, /\bplaywright\b/i]],
  ['quality/lint', [/\blinter\b/i, /\bformatter\b/i, /\bstyle\s+check\b/i]],
  // --- Security / operations ---
  ['security', [/\bsecurity\s+audit\b/i, /\bvulnerability\b/i, /\bencrypt/i,
                /\bcrypto/i, /\bauth\s+best\b/i, /\bsecret\s+detect/i]],
  ['operations/observability', [/\bobservab/i, /\bstructured\s+log/i, /\bmetric/i,
                                /\bgrafana\b/i, /\bprometheus\b/i, /\bdatadog\b/i]],
  ['operations/crash', [/\bcrash\s+report/i, /\bsentry\b/i, /\bcrashlytics\b/i,
                        /\bsymbolication\b/i]],
  // --- Planning / methodology ---
  ['planning/architecture', [/\barchitecture\b/i, /\bsystem\s+design\b/i, /\bsolution\s+design\b/i]],
  ['planning/requirements', [/\bprd\b/i, /\bproduct\s+requirement\b/i, /\bproduct\s+brief\b/i]],
  ['planning/methodology', [/\bbrainstorm/i, /\bideation\b/i, /\bsprint\b/i,
                            /\bretrospective\b/i, /\bmethodology\b/i]],
  // --- Docs / design ---
  ['docs/office', [/\bspreadsheet\b/i, /\bxlsx?\b/i, /\bexcel\b/i, /\bword\s+doc/i,
                   /\bdocx?\b/i, /\bpowerpoint\b/i, /\bpptx\b/i, /\bpdf\b/i]],
  ['docs/prose', [/\bcopy.?edit/i, /\bprose\b/i, /\beditorial\b/i,
                  /\bdocstring/i, /\bapi\s+documentation/i, /\btechnical\s+writing/i]],
  ['design/frontend', [/\bfrontend\s+design\b/i, /\bui\s+design\b/i,
                       /\bcomponent\s+design\b/i, /\bbrand\s+guideline\b/i]],
  ['design/visual', [/\bvisual\s+art\b/i, /\bcanvas\s+design\b/i,
                     /\bgenerative\s+art\b/i, /\balgorithmic\s+art\b/i]],
  // --- Mobile platform tooling ---
  ['mobile/deploy', [/\bapp\s+store\b/i, /\bplay\s+store\b/i, /\bios\s+deploy/i, /\bota\b/i]],
  ['mobile/simulator', [/\bsimulator\b/i, /\bemulator\b/i]],
  // --- Meta ---
  ['meta/skill-authoring', [/\bskill\s+creator\b/i, /\bmcp\s+build/i, /\bclaude\s+api\b/i]],
];

// Secondary tag-based fallback for category inference
function tagFallbackCategory(
  tagSet: Set<string>,
  defaultSet: Set<string>,
): string | null {
  const matchers: Array<[string, (t: Set<string>, d: Set<string>) => boolean]> = [
    ['data-ml/general', (t, d) => t.has('data_pipeline') || d.has('data-ml')],
    ['cli/general', (t, d) => t.has('cli_only') || d.has('cli-tool')],
    ['mobile/general', (t, d) => t.has('has_mobile_ui') || d.has('mobile')],
    ['infrastructure/docker', (t, d) => t.has('has_docker') && t.has('serves_traffic')],
    ['infrastructure/ci', (t, d) => t.has('has_ci') && t.size <= 2],
    ['framework/web-general', (t, d) => t.has('has_web') && t.has('has_ui')],
    ['backend/general', (t, d) => t.has('has_api') || d.has('backend-api')],
    ['library/general', (t, d) => t.has('is_library') || d.has('library')],
  ];

  for (const [category, matcher] of matchers) {
    try {
      if (matcher(tagSet, defaultSet)) {
        return category;
      }
    } catch {
      continue;
    }
  }
  return null;
}

function matchAny(text: string, patterns: RegExp[]): boolean {
  return patterns.some((p) => p.test(text));
}

/**
 * Infer characteristic tags and match_language from a skill description.
 */
export function inferTags(
  description: string,
  name: string = '',
): { tags: string[]; matchLanguage: string | null } {
  const text = (description + ' ' + name).toLowerCase();
  const tags: string[] = [];

  for (const [flag, patterns] of TAG_KEYWORDS) {
    if (matchAny(text, patterns)) {
      tags.push(flag);
    }
  }

  // Only set match_language if exactly ONE language is detected.
  // Multiple language mentions (e.g. "Swift, Kotlin, TypeScript") means
  // the skill is cross-language, not language-specific.
  const matchedLangs: string[] = [];
  for (const [lang, patterns] of LANGUAGE_KEYWORDS) {
    if (matchAny(text, patterns)) {
      matchedLangs.push(lang);
    }
  }
  const matchLanguage = matchedLangs.length === 1 ? matchedLangs[0]! : null;

  return { tags, matchLanguage };
}

/**
 * Full inference — tags, default_for, match_language, boost_when, penalize_when.
 * Used by marketplace adapter for Shape B / Shape C skills.
 */
export function inferFullMetadata(
  description: string,
  name: string = '',
): {
  tags: string[];
  boost_when: string[];
  penalize_when: string[];
  default_for: string[];
  match_language: string | null;
  match_framework: string | null;
  match_sub_framework: string | null;
} {
  const text = (description + ' ' + name).toLowerCase();
  const tags: string[] = [];

  for (const [flag, patterns] of TAG_KEYWORDS) {
    if (matchAny(text, patterns)) {
      tags.push(flag);
    }
  }

  const default_for: string[] = [];
  for (const [projectType, patterns] of PROJECT_TYPE_KEYWORDS) {
    if (matchAny(text, patterns)) {
      default_for.push(projectType);
    }
  }

  // Only set match_language if exactly ONE language is detected.
  const matchedLangs: string[] = [];
  for (const [lang, patterns] of LANGUAGE_KEYWORDS) {
    if (matchAny(text, patterns)) {
      matchedLangs.push(lang);
    }
  }
  const match_language = matchedLangs.length === 1 ? matchedLangs[0]! : null;

  return {
    tags,
    boost_when: [],
    penalize_when: [],
    default_for,
    match_language,
    match_framework: null,
    match_sub_framework: null,
  };
}

/**
 * Infer a single category for a skill.
 * Primary: description + name keyword match against CATEGORY_KEYWORDS.
 * Secondary: tag-based fallback using skill characteristics.
 */
export function inferCategory(
  description: string,
  name: string = '',
  tags?: string[],
  defaultFor?: string[],
): string | null {
  const text = (description + ' ' + name).toLowerCase();

  for (const [category, patterns] of CATEGORY_KEYWORDS) {
    if (matchAny(text, patterns)) {
      return category;
    }
  }

  // Secondary: tag-based fallback
  if (tags !== undefined || defaultFor !== undefined) {
    const tagSet = new Set(tags ?? []);
    const defaultSet = new Set(defaultFor ?? []);
    return tagFallbackCategory(tagSet, defaultSet);
  }

  return null;
}
