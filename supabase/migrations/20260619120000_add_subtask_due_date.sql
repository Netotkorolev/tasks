-- Реверс решения из 20260615080403_create_subtasks.sql ("у подзадачи нет due_date") — слонам нужны датированные шаги.
alter table public.subtasks
add column if not exists due_date date null;
