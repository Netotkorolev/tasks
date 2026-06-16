alter table public.tasks
  add column if not exists frog_mode text not null default 'auto'
  check (frog_mode in ('auto', 'manual', 'blocked'));
