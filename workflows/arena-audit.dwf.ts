/* zcode-workflow
description: "ممیزی آرنای کل پروژه با الگوی تورنمنت (اقتباس از arena-skill):
  گیت‌های ماشینی، ممیزهای موازی با عدسی‌های برگرفته از مستندات خود پروژه، تأیید
  مستقل هر یافته، داوری نهایی و گزارش مارک‌داون."
whenToUse: "هر وقت بخواهی یک ممیزی عمیق چند-عاملی از کل ریپو داشته باشی: ابتدا
  گیت‌های ماشینی (typecheck/lint/test) اجرا می‌شوند، بعد یک عامل «طراح ممیزی» از
  مستندات خود پروژه (AGENTS.md/CLAUDE.md/README) عدسی‌های ممیزی را استخراج
  می‌کند، سپس ممیزهای موازی هر یافته را با تأییدکنندهٔ مستقل می‌سنجند و در پایان
  قاضی نهایی گزارش اولویت‌بندی‌شده می‌سازد. مستقل از نوع پروژه است؛ در هر
  ورک‌اسپیس قابل اجراست."
*/
// ممیزی آرنا — الگوی تورنمنت، نسخهٔ عمومی برای هر ریپو
// گیت‌های ماشینی → طراحی عدسی‌ها از مستندات خود پروژه → بررسی موازی + تأیید مستقل هر یافته → داوری نهایی

interface RawFinding {
  /** مسیر نسبی فایل همراه شماره خط، مثل "src/x.ts:42" */
  path: string;
  /** یک جمله: چه چیزی اشتباه است، نه چطور درستش کنیم */
  problem: string;
  /** شاهد: نقل کوتاه کد یا توضیح دقیق مستند به فایل خوانده‌شده */
  evidence: string;
  /** اهمیت: «high» فقط برای باگ واقعی، خرابی داده یا خطر امنیتی */
  severity: "low" | "medium" | "high";
}

interface LensReview {
  /** یک جمله درباره وضعیت کلی این حوزه: چه چیزهایی سالم انجام شده و چه چیزی نگران‌کننده است */
  healthNote: string;
  /** حداکثر ۶ یافتهٔ مهم؛ اگر حوزه سالم است خالی بماند */
  findings: RawFinding[];
}

interface Confirmation {
  /** یافته پس از بازخوانی مستقل کد تأیید می‌شود؟ */
  confirmed: boolean;
  /** حداکثر دو جمله: اصلاح مسیر/خط، دلیل رد، یا نکتهٔ دقیق‌کننده */
  note: string;
  /** شدت نهایی پس از ارزیابی مستقل */
  severity: "low" | "medium" | "high";
}

interface FinalFinding {
  id: string;
  lens: string;
  where: string;
  what: string;
  evidence: string;
  status: "verified" | "unconfirmed";
  severity: "low" | "medium" | "high";
  note: string;
}

interface GateResult {
  name: string;
  ok: boolean;
  detail: string;
}

interface Lens {
  /** شناسهٔ یکتای لاتین عدسی، مثل "security" */
  id: string;
  /** عنوان فارسی حوزهٔ تخصصی ممیزی */
  title: string;
  /** مسیرها یا فایل‌های پیشنهادی فوکوس برای این عدسی */
  focus: string;
  /** ۴ تا ۵ الزام مشخص و قابل بررسی با خواندن کد */
  checklist: string[];
}

interface LensPlan {
  /** نام کوتاه پروژه، از مستندات یا package.json */
  projectName: string;
  /** یک پاراگراف: این پروژه چیست، با چه فناوری‌هایی، و مهم‌ترین حساسیت‌هایش */
  projectDescription: string;
  /** ۴ تا ۷ عدسی ممیزی برگرفته از الزامات و قراردادهای خود پروژه */
  lenses: Lens[];
}

interface LensOutcome {
  lens: Lens;
  healthNote?: string;
  confirmed?: FinalFinding[];
  error?: string;
}

interface JudgeOutput {
  /** دو تا سه جمله جمع‌بندی صادقانه به فارسی: پروژه در مجموع درست پیش رفته یا نه */
  summary: string;
  /** حداکثر ۸ مورد، مرتب بر اساس اهمیت */
  priorities: {
    /** مسیر یا گیت مرتبط */
    where: string;
    /** یک جمله: چه چیزی باید اصلاح شود */
    what: string;
    severity: "low" | "medium" | "high";
  }[];
}

const SEVERITY_FA: Record<string, string> = { high: "بحرانی", medium: "متوسط", low: "کم" };

function tail(s: string, n: number): string {
  return s.length > n ? "…" + s.slice(s.length - n) : s;
}

const FALLBACK_LENSES: Lens[] = [
  {
    id: "correctness",
    title: "درستی و باگ‌های منطقی",
    focus: "منطق اصلی کسب‌وکار و مسیرهای حساس داده",
    checklist: [
      "حالت‌های مرزی (ورودی خالی، صفر، مقدار null) بدون کرش مدیریت شده باشند",
      "خطاها به‌جای بی‌صدا بلعیده‌شدن، ثبت یا به بالا منتقل شده باشند",
      "شرط‌های منطقی با واقعیت دامنه هم‌خوان باشند",
    ],
  },
  {
    id: "security",
    title: "امنیت",
    focus: "مدیریت اسرار، اعتبارسنجی ورودی، دسترسی‌ها",
    checklist: [
      "هیچ secret یا کلیدی در ریپو یا لاگ‌ها درز نکرده باشد",
      "ورودی‌های خارجی پیش از استفاده اعتبارسنجی شده باشند",
      "دسترسی به داده‌های حساس محافظت شده باشد",
    ],
  },
  {
    id: "architecture",
    title: "معماری و لایه‌بندی",
    focus: "ساختار پوشه‌ها و مرزهای ماژول‌ها",
    checklist: [
      "وابستگی‌ها یک‌طرفه و مطابق لایه‌بندی اعلام‌شده باشد",
      "منطق دامنه از جزئیات فریم‌ورک جدا باشد",
      "قراردادهای مشترک بین ماژول‌ها ناگسسته باشد",
    ],
  },
  {
    id: "testing",
    title: "تست و پوشش رفتار",
    focus: "پوشه‌های تست و اسکریپت‌های verify در package.json",
    checklist: [
      "مسیرهای حساس کسب‌وکار تست داشته باشند",
      "تست‌ها رفتار واقعی را بررسی کنند نه پیاده‌سازی داخلی",
      "اسکریپت‌های verify پروژه کامل و قابل اجرا باشند",
    ],
  },
  {
    id: "build-config",
    title: "پیکربندی بیلد و ابزارها",
    focus: "package.json، فایل‌های پیکربندی، CI",
    checklist: [
      "پیکربندی‌ها با هم ناسازگار نباشند (نسخه‌ها، مسیرها، پرچم‌ها)",
      "فایل‌های حساس (env، کلید) در gitignore باشند",
      "پایپ‌لاین CI در صورت وجود، گیت‌های اصلی را اجرا کند",
    ],
  },
];

artifact.board("findings", {
  title: "یافته‌های ممیزی",
  description: "هر یافته پس از بازخوانیِ یک تأییدکنندهٔ مستقل اینجا ثبت می‌شود",
  key: "id",
  status: "state",
  columns: ["تأیید شده", "نیاز به بازبینی انسانی"],
  cardTitle: "short",
  detail: [
    { field: "severityFa", label: "شدت" },
    { field: "where", label: "مسیر" },
  ],
});

function toBoard(f: FinalFinding) {
  return {
    id: f.id,
    state: f.status === "verified" ? "تأیید شده" : "نیاز به بازبینی انسانی",
    short: f.what,
    severityFa: SEVERITY_FA[f.severity] ?? f.severity,
    where: f.where,
  };
}

function designerAsk(): string {
  return [
    "پروژهٔ موجود در پوشهٔ کاری تو را برای یک ممیزی چند-عاملی آماده کن:",
    "",
    "۱. مستندات ریشه را بخوان: AGENTS.md، CLAUDE.md، README.md، CONTRIBUTING.md، package.json، و در صورت وجود .github/workflows و مستندات معماری.",
    "۲. نام کوتاه پروژه و یک پاراگراف توضیح (چیست، با چه فناوری‌هایی، حساسیت‌های اصلی‌اش کجاست) استخراج کن.",
    "۳. بین ۴ تا ۷ «عدسی ممیزی» طراحی کن: حوزه‌های تخصصی که یک ممیز ارشد باید این پروژه را از دریچهٔ آن‌ها بخواند. عدسی‌ها باید از الزامات و قراردادهای خودِ همین پروژه بیایند (قوانین AGENTS.md، invariantهای مستندشده، قراردادهای معماری)، نه یک چک‌لیست عمومی.",
    "۴. برای هر عدسی: شناسهٔ لاتین یکتا (مثل security)، عنوان فارسی، فوکوس (مسیرها یا فایل‌های پیشنهادی)، و ۴ تا ۵ الزام مشخص و قابل بررسی با خواندن کد.",
    "",
    "قواعد:",
    "- فقط بخوان؛ هیچ فایلی را ویرایش نکن.",
    "- اگر مستندات قوانین صریح ندارد، عدسی‌ها را از قراردادهای قابل‌مشاهدهٔ خود کدبیس (الگوهای تکرارشونده، اسکریپت‌های verify، ساختار پوشه‌ها) بساز و در فوکوس به آن‌ها ارجاع بده.",
    "- همهٔ متن‌ها فارسی باشد؛ شناسه‌ها لاتین بمانند.",
  ].join("\n");
}

function reviewerSystem(lens: Lens): string {
  return (
    "تو ممیز ارشد نرم‌افزار هستی و در تورنمنت ممیزی این پروژه فقط نقش «" +
    lens.title +
    "» را داری. استاندارد کار: هر ادعا فقط با خواندن کد واقعی و ارجاع «مسیر:خط» مستند شود؛ هیچ فایلی را ویرایش نکن؛ اگر چیزی را نمی‌توانی بررسی کنی صریح بگو و حدس نزن."
  );
}

function reviewerAsk(lens: Lens, projectName: string, projectDescription: string): string {
  const desc = projectDescription.trim().length > 0 ? " (" + projectDescription.trim() + ")" : "";
  return [
    "کل کدبیس «" + projectName + "»" + desc + " را از دریچهٔ تخصصی «" + lens.title + "» ممیزی کن. ریشهٔ پروژه همان پوشهٔ کاری توست.",
    "",
    "فوکوس پیشنهادی (سرنخ است، محدودیت نیست): " + lens.focus,
    "",
    "چک‌لیست الزامات این حوزه (برگرفته از مستندات و قراردادهای خود پروژه):",
    ...lens.checklist.map((c, i) => (i + 1) + ". " + c),
    "",
    "قواعد:",
    "- فقط بخوان؛ هیچ فایلی را ویرایش نکن.",
    "- حداکثر ۶ یافتهٔ مهم بده؛ سبک‌کاری و سلیقه‌ای‌ها را ننویس. اگر حوزه سالم است، findings خالی کاملاً درست است.",
    "- برای هر یافته: مسیر دقیق «مسیر:خط»، شرح یک‌جمله‌ای مشکل، و شاهد (نقل کوتاه کد یا توضیح مستند).",
    "- گیت‌های ماشینی (typecheck و مانند آن) را خودِ workflow جداگانه اجرا می‌کند؛ تو تکرارشان نکن و روی کد تمرکز کن.",
    "- همهٔ متن‌ها فارسی باشد؛ نقل کد انگلیسی می‌ماند.",
  ].join("\n");
}

function confirmerAsk(lens: Lens, f: RawFinding): string {
  return [
    "یک یافتهٔ ممیزی از عدسی «" + lens.title + "» به تو ارجاع شده است. مستقل از ممیزِ پیداکننده، فقط با خواندن خودِ کد تصمیم بگیر که آیا این یافته واقعی، دقیق و با شدت درست است.",
    "",
    "یافته: " + JSON.stringify(f),
    "",
    "قواعد:",
    "- فقط بخوان؛ هیچ فایلی را ویرایش نکن.",
    "- مسیر و خط را باز کن. اگر مسیر یا شرح کمی نادرست است ولی مشکل مشابه واقعاً وجود دارد، confirmed=true و در note مسیر درست را بده.",
    "- اگر مشکل اصلاً وجود ندارد یا برداشت اشتباه است، confirmed=false و دلیل را در note بنویس.",
    "- شدت را دوباره ارزیابی کن: «high» فقط برای باگ واقعی، از دست رفتن داده یا خطر امنیتی.",
    "- پاسخ فارسی باشد و note حداکثر دو جمله.",
  ].join("\n");
}

const JUDGE_SYSTEM =
  "تو قاضی نهایی تورنمنت ممیزی و مهندس ارشد (principal) هستی. فقط با فهرست یافته‌ها و نتایج گیت‌ها داوری کن؛ یافته‌های verified وزن اصلی را دارند و unconfirmed فقط با برچسب وضعیتشان ذکر می‌شوند. صادق و کالیبره باش: نه اغراق کن، نه ترس پخش کن.";

function judgeAsk(
  projectName: string,
  projectDescription: string,
  gates: GateResult[],
  findings: FinalFinding[],
  healthNotes: { lens: string; note: string }[],
): string {
  const narrow = findings.map((f) => ({
    lens: f.lens,
    where: f.where,
    what: f.what,
    severity: f.severity,
    status: f.status,
    note: tail(f.note, 200),
  }));
  const desc = projectDescription.trim().length > 0 ? " (" + projectDescription.trim() + ")" : "";
  return [
    "نتایج ممیزی چند-عاملی پروژهٔ «" + projectName + "»" + desc + ":",
    "",
    "گیت‌های ماشینی:",
    ...(gates.length > 0
      ? gates.map((g) => "- " + g.name + ": " + (g.ok ? "گذشت" : "رد شد — " + tail(g.detail, 200)))
      : ["- هیچ گیت ماشینی شناخته‌شده‌ای پیدا و اجرا نشد."]),
    "",
    "یادداشت سلامت ممیزها (با تردید بخوان؛ وزن اصلی با یافته‌های verified است):",
    ...healthNotes.map((h) => "- " + h.lens + ": " + h.note),
    "",
    "یافته‌ها:",
    JSON.stringify(narrow),
    "",
    "کار تو:",
    "۱. یافته‌های همپوشان را در نظر بگیر و در اولویت‌ها هر مشکل را فقط یک‌بار بیاور.",
    "۲. حداکثر ۸ اولویت اصلاح به ترتیب اهمیت بده (ترجیح با verifiedها؛ unconfirmed فقط اگر خیلی مهم است).",
    "۳. در summary دو-سه جمله‌ای، صریح بگو پروژه در مجموع «درست پیش رفته یا نه» — هم قوت‌ها، هم ضعف‌های اصلی. فارسی بنویس.",
  ].join("\n");
}

function buildMarkdown(
  projectName: string,
  lensCount: number,
  judgeOut: JudgeOutput,
  gates: GateResult[],
  findings: FinalFinding[],
  healthNotes: { lens: string; note: string }[],
  lensErrors: string[],
): string {
  const lines: string[] = [];
  lines.push("# گزارش ممیزی آرنا — " + projectName, "");
  lines.push("ممیزی چند-عاملی با الگوی تورنمنت: عدسی‌ها از مستندات خود پروژه، بررسی موازی، بازخوانی مستقل تک‌تک یافته‌ها، داوری نهایی.", "");
  lines.push("## جمع‌بندی قاضی", "", judgeOut.summary, "");
  lines.push("## اولویت‌های اصلاح", "");
  if (judgeOut.priorities.length === 0) lines.push("مورد اولویت‌داری ثبت نشد.", "");
  judgeOut.priorities.forEach((p, i) => {
    lines.push((i + 1) + ". **" + p.where + "** — " + p.what + " («" + (SEVERITY_FA[p.severity] ?? p.severity) + "»)");
  });
  lines.push("");
  lines.push("## گیت‌های ماشینی", "");
  if (gates.length === 0) lines.push("گیت ماشینی شناخته‌شده‌ای (tsc/eslint/vitest/jest) در این پروژه پیدا نشد.", "");
  for (const g of gates) {
    lines.push("- «" + g.name + "»: " + (g.ok ? "✅ گذشت" : "❌ رد شد — " + tail(g.detail, 400)));
  }
  lines.push("");
  lines.push("## یافته‌ها به تفکیک عدسی", "");
  const groups = new Map<string, FinalFinding[]>();
  for (const f of findings) {
    const arr = groups.get(f.lens);
    if (arr) arr.push(f);
    else groups.set(f.lens, [f]);
  }
  for (const [lensTitle, fs] of groups) {
    const note = healthNotes.find((h) => h.lens === lensTitle);
    lines.push("### " + lensTitle, "");
    if (note) lines.push("_" + note.note + "_", "");
    if (fs.length === 0) lines.push("یافته‌ای ثبت نشد.", "");
    for (const f of fs) {
      lines.push("- **«" + (SEVERITY_FA[f.severity] ?? f.severity) + "» · " + (f.status === "verified" ? "تأیید شده" : "نیاز به بازبینی") + "** — `" + f.where + "`");
      lines.push("  - مشکل: " + f.what);
      lines.push("  - شاهد: " + f.evidence);
      lines.push("  - تأییدکننده: " + f.note);
    }
    lines.push("");
  }
  if (lensErrors.length > 0) {
    lines.push("## عدسی‌های ناتمام", "");
    for (const e of lensErrors) lines.push("- " + e);
    lines.push("");
  }
  lines.push("## پوشش ممیزی", "");
  lines.push("- بررسی‌شده: نمونه‌برداری هدفمند از کل کدبیس از " + lensCount + " عدسی + " + gates.length + " گیت ماشینی + بازخوانی مستقل هر یافته.", "");
  lines.push("- پوشش‌نداده: بیلد کامل پروژه، اجرا در محیط واقعی یا روی دستگاه، و پوشش خط‌به‌خط تضمین‌شدهٔ کدبیس.", "");
  return lines.join("\n");
}

// --- کشف خودکار گیت‌های ماشینی (تنظیمات اولیه، پیش از اولین فاز) ---
interface GateCandidate {
  name: string;
  kind: string;
  probe: string;
  bin: string;
  args: string[];
}
const GATE_CANDIDATES: GateCandidate[] = [
  { name: "typecheck", kind: "check", probe: "node_modules/typescript/bin/*", bin: "node_modules/typescript/bin/tsc", args: ["--noEmit"] },
  { name: "lint", kind: "check", probe: "node_modules/eslint/bin/*", bin: "node_modules/eslint/bin/eslint.js", args: ["."] },
  { name: "test", kind: "test", probe: "node_modules/vitest/*.mjs", bin: "node_modules/vitest/vitest.mjs", args: ["run"] },
  { name: "test", kind: "test", probe: "node_modules/jest/bin/*", bin: "node_modules/jest/bin/jest.js", args: [] },
];
const availableGates: { name: string; bin: string; args: string[] }[] = [];
let testGatePicked = false;
for (const c of GATE_CANDIDATES) {
  try {
    const hits = await files.glob(c.probe);
    if (!hits.includes(c.bin)) continue;
  } catch {
    continue;
  }
  if (c.kind === "test") {
    if (testGatePicked) continue;
    testGatePicked = true;
  }
  availableGates.push({ name: c.name, bin: c.bin, args: c.args });
}

phase("اجرای گیت‌های ماشینی پروژه");
const gates: GateResult[] = [];
const gateFindings: FinalFinding[] = [];
if (availableGates.length === 0) {
  log("هیچ گیت ماشینی شناخته‌شده‌ای (tsc/eslint/vitest/jest) پیدا نشد؛ ممیزی فقط با ممیزهای مدل ادامه می‌یابد.");
}
for (const g of availableGates) {
  let ok = false;
  let detail = "";
  try {
    const r = await world.run("node", [g.bin, ...g.args], { timeoutMs: 600000 });
    ok = r.exitCode === 0;
    detail = ok ? tail(r.stdout, 300) : tail(r.stderr, 1200) || tail(r.stdout, 1200);
  } catch (e) {
    ok = false;
    detail = "اجرای دستور ممکن نشد: " + String(e);
  }
  gates.push({ name: g.name, ok: ok, detail: detail });
  log("گیت «" + g.name + "»: " + (ok ? "گذشت ✓" : "رد شد ✗"));
  if (!ok) {
    const f: FinalFinding = {
      id: "gate-" + g.name,
      lens: "گیت ماشینی",
      where: g.bin + " " + g.args.join(" "),
      what: "گیت ماشینی «" + g.name + "» رد شد — این یک مانع کیفیتی است.",
      evidence: tail(detail, 800),
      status: "verified",
      severity: "high",
      note: "تأیید با کد خروج خود دستور (exit code).",
    };
    gateFindings.push(f);
    report(toBoard(f), "findings");
  }
}

phase("شناخت پروژه و طراحی عدسی‌های ممیزی");
let plan: LensPlan;
try {
  plan = await agent("طراح ممیزی", {
    system: "تو مهندس ارشد و طراح ممیزی هستی؛ مستندات پروژه را می‌خوانی و از دل الزامات خودش عدسی‌های ممیزی می‌سازی. هیچ فایلی را ویرایش نکن؛ اگر مستندات ناکافی است از قراردادهای خود کدبیس استنباط کن و حدس‌های مستند بزن.",
  }).ask<LensPlan>(designerAsk());
} catch (e) {
  log("طراح ممیزی در دسترس نبود؛ عدسی‌های عمومی جایگزین می‌شوند: " + String(e));
  plan = { projectName: "پروژه", projectDescription: "", lenses: FALLBACK_LENSES };
}
const projectName = plan.projectName.trim().length > 0 ? plan.projectName.trim() : "پروژه";
const lenses = plan.lenses.length >= 2 ? plan.lenses : FALLBACK_LENSES;
log("ممیزی «" + projectName + "» با " + lenses.length + " عدسی آغاز می‌شود.");

phase("بررسی موازی از زوایای مختلف و تأیید مستقل یافته‌ها");
log(lenses.length + " ممیز مستقل با عدسی‌های متفاوت روی پروژه کار می‌کنند؛ هر یافته بلافاصله به یک تأییدکنندهٔ جدا ارجاع می‌شود.");
const outcomes: LensOutcome[] = await Promise.all(
  lenses.map(async (lens): Promise<LensOutcome> => {
    let review: LensReview;
    try {
      review = await agent("ممیز " + lens.title + " (" + lens.id + ")", {
        system: reviewerSystem(lens),
      }).ask<LensReview>(reviewerAsk(lens, projectName, plan.projectDescription));
    } catch (e) {
      return { lens: lens, error: String(e) };
    }
    const kept = review.findings.slice(0, 8);
    log("عدسی «" + lens.title + "»: " + kept.length + " یافته برای تأیید مستقل");
    const confirmed: FinalFinding[] = await Promise.all(
      kept.map(async (f, i): Promise<FinalFinding> => {
        let conf: Confirmation | null = null;
        try {
          conf = await agent("تأییدکننده " + lens.title + " #" + (i + 1), {
            system: "تو تأییدکنندهٔ مستقل یافته‌های ممیزی هستی. فقط با خواندن خودِ کد تصمیم بگیر؛ هیچ فایلی را ویرایش نکن؛ اگر یافته اشتباه یا غیرقابل بازتولید است، ردش کن.",
          }).ask<Confirmation>(confirmerAsk(lens, f));
        } catch (e) {
          conf = null;
        }
        const vf: FinalFinding = {
          id: lens.id + "-" + (i + 1),
          lens: lens.title,
          where: f.path,
          what: f.problem,
          evidence: f.evidence,
          status: conf && conf.confirmed ? "verified" : "unconfirmed",
          severity: conf ? conf.severity : f.severity,
          note: conf ? conf.note : "تأییدکننده در دسترس نبود؛ نیازمند بازبینی انسانی.",
        };
        report(toBoard(vf), "findings");
        return vf;
      }),
    );
    return { lens: lens, healthNote: review.healthNote, confirmed: confirmed };
  }),
);

const lensFindings: FinalFinding[] = [];
const healthNotes: { lens: string; note: string }[] = [];
const lensErrors: string[] = [];
for (const o of outcomes) {
  if (o.error !== undefined) {
    lensErrors.push(o.lens.title + ": " + o.error);
    continue;
  }
  if (o.healthNote !== undefined) healthNotes.push({ lens: o.lens.title, note: o.healthNote });
  if (o.confirmed !== undefined) lensFindings.push(...o.confirmed);
}
const allFindings: FinalFinding[] = [...gateFindings, ...lensFindings];

phase("قضاوت نهایی و تهیهٔ گزارش");
log(allFindings.length + " یافته برای داوری نهایی ثبت شده است.");
const judgeOut = await agent("قاضی نهایی", { system: JUDGE_SYSTEM }).ask<JudgeOutput>(
  judgeAsk(projectName, plan.projectDescription, gates, allFindings, healthNotes),
);
const md = buildMarkdown(projectName, lenses.length, judgeOut, gates, allFindings, healthNotes, lensErrors);
try {
  await artifact.markdown("report", md, {
    title: "گزارش ممیزی آرنا — " + projectName,
    description: tail(judgeOut.summary, 180),
    primary: true,
  });
} catch (e) {
  log("انتشار گزارش مارک‌داون ناموفق بود: " + String(e));
}

return {
  conclusion: judgeOut.summary,
  project: projectName,
  findings: allFindings.map((f) => ({
    where: f.where,
    what: f.what,
    evidence: f.evidence,
    status: f.status,
    severity: f.severity,
    lens: f.lens,
    note: f.note,
  })),
  priorities: judgeOut.priorities,
  verified: [
    ...gates.map((g) => "گیت «" + g.name + "»: " + (g.ok ? "گذشت" : "رد شد — " + tail(g.detail, 120))),
    "هر یافتهٔ ممیزها توسط یک ساب‌ایجنت مستقل (تأییدکننده) با خواندن مجدد کد بازخوانی شد",
  ],
  notCovered: [
    "بیلد کامل پروژه و اجرای آن در محیط واقعی انجام نشد",
    "بررسی‌گرها نمونه‌برداری هدفمند کردند؛ پوشش خط‌به‌خط تضمین‌شده نیست",
    ...(availableGates.length === 0
      ? ["هیچ گیت ماشینی شناخته‌شده‌ای (tsc/eslint/vitest/jest) پیدا نشد؛ کیفیت ماشینی بررسی نشد"]
      : []),
    ...lensErrors.map((e) => "عدسی ناتمام: " + e),
  ],
  healthNotes: healthNotes,
  gates: gates.map((g) => ({ name: g.name, ok: g.ok })),
};