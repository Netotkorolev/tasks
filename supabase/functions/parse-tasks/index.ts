import { createClient } from 'jsr:@supabase/supabase-js@2';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
};

const ALLOWED_PROJECTS = ['law', 'popcorn', 'politics', 'fencing', 'china', 'istra', 'tma', 'health', 'personal', 'other'];
const ALLOWED_EFFORT = ['2m', '5m', '15m', '30m', '60m', 'elephant'];
const ALLOWED_STATUS = ['inbox', 'next', 'scheduled', 'waiting', 'someday'];
const MAX_TASKS = 20;

const TASK_SCHEMA = {
  type: 'object',
  properties: {
    tasks: {
      type: 'array',
      items: {
        type: 'object',
        properties: {
          text: { type: 'string' },
          project: { type: 'string', enum: ALLOWED_PROJECTS },
          urgent: { type: 'boolean' },
          important: { type: 'boolean' },
          due_date: { type: ['string', 'null'] },
          notes: { type: ['string', 'null'] },
          effort: { type: ['string', 'null'], enum: [...ALLOWED_EFFORT, null] },
          status: { type: 'string', enum: ALLOWED_STATUS },
          desc: { type: ['string', 'null'] },
        },
        required: ['text', 'project', 'urgent', 'important', 'due_date', 'notes', 'effort', 'status', 'desc'],
        additionalProperties: false,
      },
    },
  },
  required: ['tasks'],
  additionalProperties: false,
};

function jsonResponse(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, 'Content-Type': 'application/json' },
  });
}

const WEEKDAY_NAMES = ['понедельник', 'вторник', 'среда', 'четверг', 'пятница', 'суббота', 'воскресенье'];
// понедельник..воскресенье -> соответствующий индекс Date.getUTCDay() (0=воскресенье..6=суббота)
const WEEKDAY_JS_INDEX = [1, 2, 3, 4, 5, 6, 0];

function getMoscowTodayISO(): string {
  return new Intl.DateTimeFormat('en-CA', { timeZone: 'Europe/Moscow', year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date());
}

// Ближайшая будущая дата (1-7 дней от todayISO) для дня недели weekdayIndex по конвенции Date.getUTCDay(): 0=воскресенье..6=суббота.
// Пример: getNextWeekdayISO('2026-06-13', 5) (пятница, 2026-06-13 — суббота) -> '2026-06-19'.
function getNextWeekdayISO(todayISO: string, weekdayIndex: number): string {
  const [y, m, d] = todayISO.split('-').map(Number);
  const todayUTC = new Date(Date.UTC(y, m - 1, d));
  let diff = weekdayIndex - todayUTC.getUTCDay();
  if (diff <= 0) diff += 7;
  const date = new Date(todayUTC);
  date.setUTCDate(date.getUTCDate() + diff);
  return date.toISOString().split('T')[0];
}

// Для каждого дня недели (0=понедельник..6=воскресенье) — дата его ближайшего будущего наступления
function getUpcomingWeekdayDates(todayISO: string): string[] {
  return WEEKDAY_JS_INDEX.map((jsWeekday) => getNextWeekdayISO(todayISO, jsWeekday));
}

function buildSystemPrompt(): string {
  const todayISO = getMoscowTodayISO();
  const todayRu = new Date().toLocaleDateString('ru-RU', { day: 'numeric', month: 'long', timeZone: 'Europe/Moscow' });
  const upcomingDates = getUpcomingWeekdayDates(todayISO);
  const upcomingWeekdays = WEEKDAY_NAMES.map((name, i) => `${name} ${upcomingDates[i]}`).join(', ');
  return `Ты — личный штабной секретарь Егора. Превращай хаотичный русский текст (написанный или продиктованный) в чёткие, исполнимые задачи.

Сегодня: ${todayRu} (${todayISO}). Все относительные даты ("сегодня", "завтра", "до пятницы", "в понедельник", "на неделе") считай от этой даты.
Ближайшие даты дней недели от сегодня (всегда строго в будущем, начиная с завтра): ${upcomingWeekdays}. Используй эту таблицу для "до X"/"к X"/"в X", где X — день недели — не вычисляй день недели сам.

ГЛАВНЫЙ ПРИНЦИП
Каждая задача должна быть готова к работе: понятный text, правильный project, честная оценка urgent/important/effort. Эмоции, жалобы и комментарии сами по себе не становятся задачами. Если непонятно, что делать — создай задачу со status="inbox" и вопросом в notes, но не выдумывай детали.

1. РАЗБОР ТЕКСТА
- Одна задача = одно действие. Если в тексте несколько дел — создай несколько задач.
- Эмоции и комментарии ("бесит", "опять они тянут", "наконец-то") не становятся задачами сами по себе. Если за эмоцией стоит действие — создай задачу на это действие, эмоцию при необходимости положи в notes как контекст.
- Не создавай дубликаты: если одно и то же действие упомянуто два раза разными словами — одна задача.
- text: короткое название, глагол в начале ("Написать...", "Забрать...", "Оплатить..."), без "надо бы", "не забыть", без эмоций, конкретика — кому и что.
- Если срок уже вынесен в due_date, не повторяй его в text: убери "до пятницы", "20 июня", "завтра", "сегодня" и т.п. из названия задачи.
  Пример: due_date задан → text="Согласовать карту первых дел", а не "Согласовать карту первых дел до пятницы".

2. ЛЯГУШКУ ВЫБИРАЕШЬ НЕ ТЫ
"Лягушку дня" выбирает интерфейс приложения на экране "Сегодня" — это не статус и не effort, и ты её не назначаешь. Твоя работа — дать честное сырьё для этого выбора: important, urgent, effort, due_date. "Молния" — это effort="2m" или "5m"; присваивай эти значения, только если задача объективно занимает 2-5 минут, а не потому что хочется сделать задачу молнией.

3. ДАТА ≠ СРОЧНОСТЬ (urgent)
due_date ("когда") и urgent ("насколько горит") — независимые поля.
- Если есть будущая дата без слов давления — задача scheduled, но urgent=false.
  Пример: "20 июня оплатить аренду Истры" → due_date="${todayISO.slice(0,4)}-06-20", status="scheduled", urgent=false.
- urgent=true только если в тексте есть давление срока: "срочно", "успеть", "до...", "к...", "дедлайн", "горит", "обязательно", "к встрече", задача на сегодня/завтра, просрочено, или явные последствия промедления (блокировка, штраф, упущенная встреча).
  Пример: "до пятницы согласовать карту первых дел" → urgent=true, due_date=дата пятницы из таблицы дней недели выше, status="scheduled", effort="30m", text="Согласовать карту первых дел".
- urgent=false для: идей без срока, ожидания ответа от других, стратегических задач без даты, "когда-нибудь".

4. СРОЧНОСТЬ ≠ ВАЖНОСТЬ (important)
important=true для:
- суд и юридические риски (дедушка, дело, нотариус, иск, заседание, документы по делу);
- здоровье — своё или родственников (Пётр Михайлович, больница, лечение, врач);
- деньги, налоги, штрафы, блокировки кабинетов, финмодели;
- встречи с партнёрами/инвесторами и подготовка к ним;
- Зимин/Константин/попкорн как бизнес-контекст (не бытовой разговор);
- политика — Новые люди, карта первых дел, депутаты;
- продуктовые решения по задачнику/разработке (TMA);
- крупные стратегические задачи любого проекта.

important=false для:
- бытовых покупок, мелких быстрых ответов, простой административной рутины, нейтральных действий "для порядка".

Исключение: бытовая задача про ребёнка/семью, которая явно обещана или подчёркнута как важная ("обещал", "обязательно для дочки") → important=true.

5. РЕГУЛЯРНОСТЬ ≠ СЛОН (effort)
Если в тексте "каждый день", "ежедневно", "каждую неделю", "регулярно", "по X минут в день":
- effort = размер ОДНОГО подхода (например "по 15 минут" → effort="15m"), а НЕ "elephant";
- notes обязательно содержит периодичность, например "Регулярная задача — каждый день";
- status="next", если нет конкретной даты начала;
- important=true, если задача связана с развитием, здоровьем, обучением или долгосрочной целью.
"elephant" — это большая, размытая или многодневная задача, которую нельзя закрыть за один подход (финмодель с нуля, презентация, стратегия, "разобраться с..."), а не любая регулярная привычка.

6. ОБЪЁМ (effort): "2m", "5m", "15m", "30m", "60m", "elephant" или null
- 2m — мгновенное действие: ответить, подтвердить, переслать, быстро проверить.
- 5m — короткий звонок, короткое сообщение, простое бытовое действие.
- 15m — небольшая задача с фокусом.
- 30m — обычная рабочая задача.
- 60m — глубокая работа за один подход: анализ, подготовка, документ, встреча.
- elephant — презентация/финмодель с нуля/стратегия/большой анализ/"разобраться с большой темой".
effort ОБЯЗАТЕЛЕН, если размер задачи понятен из формулировки. null допускается только если задачу реально невозможно оценить по смыслу. Калибровка:
- "ответить курьеру" → "2m"
- "оплатить аренду" → "5m"
- "согласовать карту первых дел" → "30m"
- "разблокировать кабинет Ozon" → "30m"
- "разобрать цифры от Зимина" → "60m"
- "учить английский 15 минут" → "15m"
- "сделать сайт фехтовального клуба" → "elephant"

7. СТАТУС (status): "inbox", "next", "scheduled", "waiting", "someday"
Проверяй по порядку:
1) Формулировка непонятна, действие неясно → "inbox" + вопрос в notes (что нужно уточнить).
2) "когда-нибудь", "потом", "идея на будущее", "не сейчас", "можно было бы" → "someday".
3) "жду", "когда [имя] пришлёт/ответит/сделает", "после ответа", "после получения" → "waiting" + условие ожидания в notes (например "Жду цифры от Зимина"); due_date=null, если конкретной даты нет.
4) Есть конкретная дата → "scheduled".
5) Активная понятная задача без даты → "next".
Приоритет: someday > waiting > scheduled > next.
status НИКОГДА не равен "doing" или "done" — это ручные статусы, которые ставит только пользователь.

8. ПРОЕКТЫ (project)
law — суд, дедушка, иск, заседание, нотариус, документы по делу, юрист.
popcorn — Зимин, Константин, попкорн, Rush, финмодель попкорна, логотип для Зимина.
politics — Новые люди, партия, депутаты, карта первых дел, политика, фракция.
fencing — фехтование, Не тот Королёв, Саша, тренировка, соревнования.
china — Ozon, Wildberries, WB, Wondersell, китайские магазины/поставщики, кабинеты продавцов, блокировки, карточки товаров.
istra — Истра, помещение Истра, аренда Истра.
tma — задачник, drawer, дизайн приложения, AI prompt, Supabase, Claude, Cursor, TMA, сайт, разработка, деплой.
health — Пётр Михайлович, больница, химия, лечение, врач, здоровье родственника.
personal — покупки, семья, дети, школа, бытовое, личные финансы, своё здоровье.
other — всё неясное.

Конфликты: человек/проектный маркер сильнее общей темы.
Пример: "позвонить Зимину про сайт" → project="popcorn", а не "tma" (Зимин — маркер проекта).
Если проект не определяется уверенно — лучше project="other", чем угадывать.

9. ЗАМЕТКИ (notes)
Пиши только то, что помогает выполнить или правильно отложить задачу:
- условие ожидания (для waiting);
- источник/причина задачи;
- регулярность (для регулярных задач);
- адрес/время/имя/важная деталь;
- вопрос для уточнения (для inbox).
notes = null, если полезного контекста нет. Не дублируй text.

10. ДАТЫ (due_date)
Формат YYYY-MM-DD или null. Считай от сегодняшней даты (см. выше).
- "сегодня" → ${todayISO}; "завтра" → следующий день.
- "до X"/"к X"/"в X", где X — день недели (например "до пятницы", "к среде", "в понедельник") → бери дату этого дня из таблицы "Ближайшие даты дней недели" выше. Не вычисляй день недели сам.
- "20 июня" → конкретная дата этого (или следующего, если уже прошла) года.
- "на неделе" без конкретного дня → дата пятницы из таблицы дней недели выше, и notes уточняет "на этой неделе".
- Если в тексте нет даты — due_date=null. Не выводи дату из important/urgent.
- "после того как пришлют" без конкретной даты → due_date=null, status="waiting".

11. DESC
Короткое опциональное уточнение задачи, или null, если всё уже сказано в text/notes.`;
}

function validateTask(t: any) {
  if (!t || typeof t.text !== 'string' || !t.text.trim()) return null;
  const text = t.text.trim();
  const project = ALLOWED_PROJECTS.includes(t.project) ? t.project : 'other';
  const urgent = !!t.urgent;
  const important = !!t.important;
  const due_date = typeof t.due_date === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(t.due_date) ? t.due_date : null;
  const desc = typeof t.desc === 'string' && t.desc.trim() ? t.desc.trim() : null;
  let notes = typeof t.notes === 'string' && t.notes.trim() ? t.notes.trim() : null;
  if (notes && notes === text) notes = null;
  const effort = ALLOWED_EFFORT.includes(t.effort) ? t.effort : null;
  let status = ALLOWED_STATUS.includes(t.status) ? t.status : null;
  if (!status) status = due_date ? 'scheduled' : 'next';
  return { text, project, urgent, important, due_date, notes, effort, status, desc, done: false };
}

// "до пятницы" / "к пятнице" / "в пятницу" (и формы для других падежей) + аналоги для остальных дней недели.
// weekdayIndex — конвенция Date.getUTCDay(): 0=воскресенье..6=суббота (см. getNextWeekdayISO).
const WEEKDAY_DEADLINE_PATTERNS: { weekdayIndex: number; regex: RegExp }[] = [
  { weekdayIndex: 1, regex: /(?:до|к|в)\s+понедельник[а-я]*/i },
  { weekdayIndex: 2, regex: /(?:до|к|во?)\s+вторник[а-я]*/i },
  { weekdayIndex: 3, regex: /(?:до|к|в)\s+сред[а-я]+/i },
  { weekdayIndex: 4, regex: /(?:до|к|в)\s+четвер[а-я]+/i },
  { weekdayIndex: 5, regex: /(?:до|к|в)\s+пятниц[а-я]+/i },
  { weekdayIndex: 6, regex: /(?:до|к|в)\s+суббот[а-я]+/i },
  { weekdayIndex: 0, regex: /(?:до|к|в)\s+воскресень[а-я]+/i },
];

const MONTH_NAMES_GENITIVE = ['января', 'февраля', 'марта', 'апреля', 'мая', 'июня', 'июля', 'августа', 'сентября', 'октября', 'ноября', 'декабря'];
const MONTH_DATE_REGEX = new RegExp(`(?:до|к|на)?\\s*\\d{1,2}\\s+(?:${MONTH_NAMES_GENITIVE.join('|')})`, 'gi');
const TODAY_TOMORROW_REGEX = /(?:до|к|на)?\s*(?:сегодня|завтра)/gi;

// Слова-наполнители, смысл которых уже выражен через due_date/status/notes и не должен повторяться в text.
// Используем lookaround вместо \b, потому что в JS \b не работает на кириллице.
const FILLER_PHRASES = ['когда-нибудь', 'после получения', 'после ответа', 'когда пришлёт', 'когда пришлют', 'потом'];
const FILLER_PATTERNS = FILLER_PHRASES.map((p) => new RegExp(`(?<![а-яёА-ЯЁ])${p}(?![а-яёА-ЯЁ])`, 'gi'));

function cleanupWhitespace(text: string): string {
  return text.replace(/\s{2,}/g, ' ').replace(/^[\s,]+|[\s,]+$/g, '').trim();
}

// Убирает "когда-нибудь", "потом", "после получения/ответа", "когда пришлёт/пришлют" — независимо от due_date.
function stripFillerPhrases(text: string): string {
  let result = text;
  for (const regex of FILLER_PATTERNS) {
    result = result.replace(regex, '');
  }
  const cleaned = cleanupWhitespace(result);
  return cleaned || text;
}

// Убирает из текста хвосты с уже распознанным сроком ("до пятницы", "20 июня", "сегодня", "завтра")
function stripDeadlinePhrases(text: string): string {
  let result = text;
  for (const { regex } of WEEKDAY_DEADLINE_PATTERNS) {
    result = result.replace(regex, '');
  }
  result = result.replace(MONTH_DATE_REGEX, '').replace(TODAY_TOMORROW_REGEX, '');
  const cleaned = cleanupWhitespace(result);
  return cleaned || text;
}

// Грубая оценка effort по ключевым словам — только когда AI вернул null. Применяется к уже очищенному text.
function inferEffort(text: string): string | null {
  const t = text.toLowerCase();
  if (/ответить|подтвердить|переслать/.test(t)) return '2m';
  if (/оплатить|заказать|купить/.test(t)) return '5m';
  if (/разблокировать.*кабинет|кабинет.*ozon|разблокировать.*ozon/.test(t)) return '30m';
  if (/согласовать|созвониться|проверить/.test(t)) return '30m';
  if (/разобрать цифры|проанализировать/.test(t)) return '60m';
  if (/сделать сайт|сделать стратегию|сделать финмодель|сделать презентацию/.test(t)) return 'elephant';
  if (/учить английский/.test(t) && /15\s*минут/.test(t)) return '15m';
  return null;
}

// Серверные guardrails: исправляет очевидные ошибки AI до записи в БД
// Срочность без даты: "срочно"/"горит"/"сегодня" в тексте, либо urgent=true — и due_date всё ещё null.
const URGENCY_NO_DATE_REGEX = /срочно|горит|сегодня/i;
const NO_AUTO_DATE_STATUSES = ['waiting', 'someday', 'inbox'];

function normalizeTask(t: any, todayISO: string): any {
  let text = t.text;
  let notes = t.notes;
  let due_date = t.due_date;
  let effort = t.effort;
  let status = t.status;

  // 1. "до пятницы"/"к пятнице"/"в пятницу" (и другие дни недели) -> корректная ближайшая будущая дата,
  // даже если AI уже выставил due_date неверно.
  const haystack = `${text} ${notes ?? ''}`;
  for (const { weekdayIndex, regex } of WEEKDAY_DEADLINE_PATTERNS) {
    if (regex.test(haystack)) {
      due_date = getNextWeekdayISO(todayISO, weekdayIndex);
      break;
    }
  }

  // 1b. Срочная задача без даты ("срочно"/"горит"/"сегодня" или urgent=true) -> due_date=сегодня, status=scheduled.
  // Не трогаем waiting/someday/inbox — у них своя логика, дата на сегодня им не подходит.
  if (!due_date && !NO_AUTO_DATE_STATUSES.includes(status) && (t.urgent === true || URGENCY_NO_DATE_REGEX.test(haystack))) {
    due_date = todayISO;
    status = 'scheduled';
  }

  // 2. Убираем слова-наполнители ("когда-нибудь", "после получения" и т.п.) всегда.
  text = stripFillerPhrases(text);

  // 3. Если due_date распознан — убираем из text сам срок ("до пятницы", "20 июня", "сегодня", "завтра").
  if (due_date) {
    text = stripDeadlinePhrases(text);
  }

  if (notes && notes === text) notes = null;

  // 4. Effort fallback — после очистки text, только если AI вернул null.
  if (!effort) {
    effort = inferEffort(text);
  }

  return { ...t, text, notes, due_date, effort, status };
}

// Убирает дубли внутри одного ответа AI: одинаковый normalized text + project + due_date
function dedupeTasks(tasks: any[]): any[] {
  const result: any[] = [];
  const seen = new Map<string, number>();
  for (const t of tasks) {
    const normalizedText = t.text.toLowerCase().replace(/\s+/g, ' ').trim();
    const key = `${normalizedText}|${t.project}|${t.due_date ?? 'null'}`;
    const existingIdx = seen.get(key);
    if (existingIdx !== undefined) {
      if (!result[existingIdx].notes && t.notes) result[existingIdx].notes = t.notes;
      continue;
    }
    seen.set(key, result.length);
    result.push(t);
  }
  return result;
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders });
  }

  try {
    const authHeader = req.headers.get('Authorization');
    if (!authHeader) {
      return jsonResponse({ error: 'Нет авторизации' }, 401);
    }

    const supabaseClient = createClient(
      Deno.env.get('SUPABASE_URL')!,
      Deno.env.get('SUPABASE_ANON_KEY')!,
      { global: { headers: { Authorization: authHeader } } }
    );
    const { data: { user }, error: userError } = await supabaseClient.auth.getUser();
    if (userError || !user) {
      return jsonResponse({ error: 'Нет авторизации' }, 401);
    }

    const body = await req.json().catch(() => null);
    const input = body?.input;
    if (!input || typeof input !== 'string' || !input.trim()) {
      return jsonResponse({ error: 'Текст не может быть пустым' }, 400);
    }

    const openaiResp = await fetch('https://api.openai.com/v1/chat/completions', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': 'Bearer ' + Deno.env.get('OPENAI_API_KEY'),
      },
      body: JSON.stringify({
        model: 'gpt-4.1-mini',
        max_tokens: 2000,
        messages: [
          { role: 'system', content: buildSystemPrompt() },
          { role: 'user', content: input },
        ],
        response_format: {
          type: 'json_schema',
          json_schema: { name: 'extracted_tasks', strict: true, schema: TASK_SCHEMA },
        },
      }),
    });

    if (!openaiResp.ok) {
      const errText = await openaiResp.text();
      return jsonResponse({ error: 'Ошибка OpenAI API: ' + errText }, 502);
    }

    const completion = await openaiResp.json();
    const content = completion.choices?.[0]?.message?.content;
    let parsed: any;
    try {
      parsed = JSON.parse(content);
    } catch {
      return jsonResponse({ error: 'Модель вернула некорректный ответ' }, 502);
    }

    const rawTasks = Array.isArray(parsed?.tasks) ? parsed.tasks.slice(0, MAX_TASKS) : [];
    const todayISO = getMoscowTodayISO();
    const validTasks = rawTasks
      .map(validateTask)
      .filter((t: any) => t !== null)
      .map((t: any) => normalizeTask(t, todayISO));
    const dedupedTasks = dedupeTasks(validTasks);
    if (!dedupedTasks.length) {
      return jsonResponse({ error: 'Не удалось выделить ни одной задачи из текста' }, 422);
    }

    if (body?.dry_run === true) {
      return jsonResponse({ ok: true, tasks: dedupedTasks });
    }

    const { data: created, error: insertError } = await supabaseClient
      .from('tasks')
      .insert(dedupedTasks)
      .select();
    if (insertError) {
      return jsonResponse({ error: 'Ошибка сохранения задач: ' + insertError.message }, 500);
    }

    return jsonResponse({ ok: true, created });
  } catch (e) {
    return jsonResponse({ error: e instanceof Error ? e.message : String(e) }, 500);
  }
});
