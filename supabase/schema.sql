-- Planest schema for Supabase (family shared workspace)
-- Run in Supabase SQL Editor.

create extension if not exists "pgcrypto";

create table if not exists profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  email text,
  display_name text not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists categories (
  id uuid primary key,
  title text not null,
  owner text not null,
  owner_user_id uuid references profiles(id) on delete set null,
  color text not null,
  color_name text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists actions (
  id uuid primary key,
  category_id uuid not null references categories(id) on delete cascade,
  title text not null,
  percent_complete integer not null default 0 check (percent_complete >= 0 and percent_complete <= 100),
  due_date timestamptz,
  reminders text[] not null default '{}',
  mention_user_ids uuid[] not null default '{}',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists events (
  id uuid primary key,
  category_id uuid references categories(id) on delete set null,
  title text not null,
  description text not null default '',
  starts_at timestamptz not null,
  ends_at timestamptz not null,
  recurrence_rule text,
  exception_dates text[] not null default '{}',
  reminders text[] not null default '{}',
  mention_user_ids uuid[] not null default '{}',
  color text not null,
  color_name text,
  attachment_name text,
  attachment_data_url text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists push_subscriptions (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  endpoint text not null unique,
  p256dh text not null,
  auth text not null,
  user_agent text,
  is_active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  last_seen_at timestamptz not null default now()
);

create table if not exists push_dispatch_log (
  dispatch_key text primary key,
  user_id uuid references auth.users(id) on delete cascade,
  event_id uuid references events(id) on delete cascade,
  reminder_at timestamptz not null,
  sent_at timestamptz not null default now()
);

alter table profiles add column if not exists email text;
alter table profiles add column if not exists display_name text;
alter table categories add column if not exists owner_user_id uuid references profiles(id) on delete set null;
alter table categories add column if not exists color_name text;
alter table actions add column if not exists category_id uuid references categories(id) on delete cascade;
alter table actions add column if not exists mention_user_ids uuid[] not null default '{}';
alter table events add column if not exists exception_dates text[] not null default '{}';
alter table events add column if not exists mention_user_ids uuid[] not null default '{}';
alter table events add column if not exists color_name text;
alter table events add column if not exists description text not null default '';
alter table push_subscriptions add column if not exists user_agent text;
alter table push_subscriptions add column if not exists is_active boolean not null default true;
alter table push_subscriptions add column if not exists last_seen_at timestamptz not null default now();

do $$
begin
  if exists (
    select 1
    from information_schema.columns
    where table_schema = 'public' and table_name = 'actions' and column_name = 'item_id'
  ) and exists (
    select 1
    from information_schema.tables
    where table_schema = 'public' and table_name = 'items'
  ) then
    execute '
      update actions
      set category_id = items.category_id
      from items
      where actions.item_id = items.id
        and actions.category_id is null
    ';
    execute 'alter table actions drop column if exists item_id';
  end if;
end $$;

alter table actions alter column category_id set not null;
drop table if exists items cascade;

create or replace function public.handle_new_user_profile()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  insert into public.profiles (id, email, display_name)
  values (
    new.id,
    new.email,
    coalesce(new.raw_user_meta_data ->> 'display_name', split_part(new.email, '@', 1), 'Utente')
  )
  on conflict (id) do update set
    email = excluded.email,
    display_name = coalesce(excluded.display_name, profiles.display_name),
    updated_at = now();
  return new;
end;
$$;

drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created
after insert on auth.users
for each row execute procedure public.handle_new_user_profile();

alter table profiles enable row level security;
alter table categories enable row level security;
alter table actions enable row level security;
alter table events enable row level security;
alter table push_subscriptions enable row level security;

-- Family-shared workspace: authenticated users can read/write all planning data.
do $$
begin
  if not exists (select 1 from pg_policies where policyname = 'authenticated_read_profiles') then
    create policy authenticated_read_profiles on profiles for select using (auth.role() = 'authenticated');
  end if;

  if not exists (select 1 from pg_policies where policyname = 'self_update_profile') then
    create policy self_update_profile on profiles for update using (auth.uid() = id) with check (auth.uid() = id);
  end if;

  if not exists (select 1 from pg_policies where policyname = 'authenticated_write_profiles') then
    create policy authenticated_write_profiles on profiles for insert with check (auth.role() = 'authenticated');
  end if;

  if not exists (select 1 from pg_policies where policyname = 'authenticated_all_categories') then
    create policy authenticated_all_categories on categories for all using (auth.role() = 'authenticated') with check (auth.role() = 'authenticated');
  end if;

  if not exists (select 1 from pg_policies where policyname = 'authenticated_all_actions') then
    create policy authenticated_all_actions on actions for all using (auth.role() = 'authenticated') with check (auth.role() = 'authenticated');
  end if;

  if not exists (select 1 from pg_policies where policyname = 'authenticated_all_events') then
    create policy authenticated_all_events on events for all using (auth.role() = 'authenticated') with check (auth.role() = 'authenticated');
  end if;

  if not exists (select 1 from pg_policies where policyname = 'self_read_push_subscriptions') then
    create policy self_read_push_subscriptions on push_subscriptions for select
    using (auth.uid() = user_id);
  end if;

  if not exists (select 1 from pg_policies where policyname = 'self_insert_push_subscriptions') then
    create policy self_insert_push_subscriptions on push_subscriptions for insert
    with check (auth.uid() = user_id);
  end if;

  if not exists (select 1 from pg_policies where policyname = 'self_update_push_subscriptions') then
    create policy self_update_push_subscriptions on push_subscriptions for update
    using (auth.uid() = user_id)
    with check (auth.uid() = user_id);
  end if;

  if not exists (select 1 from pg_policies where policyname = 'self_delete_push_subscriptions') then
    create policy self_delete_push_subscriptions on push_subscriptions for delete
    using (auth.uid() = user_id);
  end if;
end $$;
