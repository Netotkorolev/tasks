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

function buildSystemPrompt(): string {
  const today = new Date();
  const todayISO = today.toISOString().split('T')[0];
  const todayRu = today.toLocaleDateString('ru-RU', { day: 'numeric', month: 'long' });
  return `Ты — личный ассистент Егора по задачам. Преобразуй хаотичный русский текст в структурированные задачи по методологии GTD (Getting Things Done) и матрице Эйзенхауэра.

Сегодня: ${todayRu} (${todayISO}).

Базовые правила:
- Одна задача = одно действие.
- Убирай мусорные слова: "надо", "не забыть", "короче", "в общем".
- Сохраняй имена, сроки и контекст.
- Если в одной фразе несколько дел — создай несколько задач.
- Если проект неясен — project = "other".
- Если дата неясна — due_date = null.
- due_date в формате YYYY-MM-DD или null.

Проекты:
law — суд, дедушка, нотариус, договор, ФНС, налоговая, юрист, документы
popcorn — Зимин, попкорн, Rush, Пуканцы, Попкульт, локация, франшиза
politics — Новые люди, депутат, выборы, Химки, карта первых дел
fencing — Саша, фехтование, тренировка, сабля, турнир, СШОР
china — Ozon, Wildberries, WB, маркетплейсы, Китай, китайские магазины, китайские продавцы, блокировки магазинов, Wondersell
istra — Истра (конкретно помещение/объект в Истре)
tma — бот, TMA, mini app, Cursor, Claude, ChatGPT, сайт, личный кабинет, интерфейс, UI, UX, frontend, дизайн приложения, разработка
health — врач, больница, здоровье, лекарство, анализы, тесть, Пётр
personal — семья, дом, машина, покупка, личное
other — всё неясное

Уточнения по проектам:
- Любое упоминание Ozon, Wildberries, WB, маркетплейсов, блокировок магазинов, китайских продавцов или магазинов → project = "china", даже если рядом есть слово "магазин" или "помещение".
- Любая задача про сайт, интерфейс, личный кабинет, UI/UX, дизайн или разработку приложения/задачника → project = "tma", а не "personal", даже если формулировка звучит как "личное".

Эйзенхауэр: urgent и important — независимые признаки, оценивай каждый отдельно. Задача может быть срочной, но не важной, и наоборот.

Срочность (urgent):
urgent = true, если задача на сегодня/завтра, связана с судом, больницей, врачом, налоговой, деньгами, встречей, документами или явно звучит срочно. Иначе false.

Важность (important):
important = true, если задача влияет на деньги, суд, здоровье, важную встречу, партнёрство, стратегию, семью, дедлайн или ключевой проект. Иначе false.

Статус (status) — этап GTD, один из: inbox, next, scheduled, waiting, someday.
- waiting и someday определяются по смыслу формулировки и имеют приоритет над scheduled/next, даже если в тексте есть дата.
- waiting — задача зависит от ответа или действия другого человека, ты ждёшь. Признаки: "жду ответ", "когда [имя] пришлёт/напишет/ответит/сделает", "после того как пришлют/ответят", "ждём от [имя]".
- someday — идея или необязательная задача "когда-нибудь", не сейчас. Признаки: "когда-нибудь", "было бы хорошо", "можно потом", "идея на будущее", "неплохо бы".
- inbox — формулировка сырая или непонятная, требует уточнения, не готова к действию.
- scheduled — есть конкретная дата (due_date задан), и задача не подходит под waiting/someday.
- next — понятная активная задача без даты, не подходит под waiting/someday.
status НИКОГДА не равен "done" — этот статус ставит только пользователь вручную после выполнения.

Объём (effort) — оценка размера задачи: 2m, 5m, 15m, 30m, 60m, elephant, или null, если непонятно.
- 2m — мгновенное действие (написать одно сообщение, сказать одну вещь).
- 5m — "молния": быстрая задача, можно сделать между делом.
- 15m — короткая задача с небольшим фокусом.
- 30m — обычная задача.
- 60m — большая задача, требует час непрерывного внимания.
- elephant — "слон": большая растянутая задача, которую нельзя сделать за один присест, нужно дробить на куски или делать регулярно.

Регулярные задачи:
Если в тексте есть формулировки вроде "каждый день", "ежедневно", "каждую неделю", "регулярно", "по X минут в день" — это не разовое действие, а регулярная привычка/практика:
- effort = "elephant".
- notes обязательно должны явно описывать периодичность, например: "Регулярная задача: каждый день по 15 минут".
- status = "next", если в тексте нет конкретной даты начала.
- important = true, если задача связана с развитием, здоровьем, обучением или долгосрочной целью (например, изучение языка, спорт, привычки).

Заметки (notes):
- Перенеси сюда важный контекст из исходного текста: детали, условия, имена, что обсудить, нюансы.
- notes = null, если дополнительного контекста нет.
- notes не должны дублировать text — это дополнение, а не повтор.

desc:
- Короткое опциональное уточнение задачи. Можно оставить null, если всё уже сказано в text/notes.`;
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
    const validTasks = rawTasks.map(validateTask).filter((t: any) => t !== null);
    if (!validTasks.length) {
      return jsonResponse({ error: 'Не удалось выделить ни одной задачи из текста' }, 422);
    }

    const { data: created, error: insertError } = await supabaseClient
      .from('tasks')
      .insert(validTasks)
      .select();
    if (insertError) {
      return jsonResponse({ error: 'Ошибка сохранения задач: ' + insertError.message }, 500);
    }

    return jsonResponse({ ok: true, created });
  } catch (e) {
    return jsonResponse({ error: e instanceof Error ? e.message : String(e) }, 500);
  }
});
