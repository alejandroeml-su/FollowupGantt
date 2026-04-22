-- =====================================================================
-- Enterprise Work Orchestration Platform - Supabase Schema
-- Version: 1.0
-- Frameworks supported: Agile (Scrum/Kanban), PMI, ITIL v4, SAFe
-- =====================================================================

-- Enable UUID extension
create extension if not exists "uuid-ossp";

-- =====================================================================
-- USERS & ROLES
-- =====================================================================
create table if not exists users (
  id uuid primary key default uuid_generate_v4(),
  email text unique not null,
  full_name text not null,
  role text not null check (role in ('admin','pm','scrum_master','po','dev','service_desk','stakeholder')),
  avatar_url text,
  created_at timestamptz default now()
);

-- =====================================================================
-- PROJECTS
-- =====================================================================
create table if not exists projects (
  id uuid primary key default uuid_generate_v4(),
  code text unique not null,
  name text not null,
  description text,
  methodology text not null default 'hybrid' check (methodology in ('agile','waterfall','hybrid','itil')),
  status text not null default 'active' check (status in ('planning','active','on_hold','completed','cancelled')),
  start_date date,
  end_date date,
  budget numeric(14,2) default 0,
  actual_cost numeric(14,2) default 0,
  owner_id uuid references users(id) on delete set null,
  created_at timestamptz default now(),
  updated_at timestamptz default now()
);

-- =====================================================================
-- SPRINTS (Agile)
-- =====================================================================
create table if not exists sprints (
  id uuid primary key default uuid_generate_v4(),
  project_id uuid references projects(id) on delete cascade,
  name text not null,
  goal text,
  start_date date not null,
  end_date date not null,
  status text not null default 'planned' check (status in ('planned','active','completed')),
  velocity numeric(6,2) default 0,
  created_at timestamptz default now()
);

-- =====================================================================
-- KANBAN COLUMNS (with WIP limits)
-- =====================================================================
create table if not exists kanban_columns (
  id uuid primary key default uuid_generate_v4(),
  project_id uuid references projects(id) on delete cascade,
  name text not null,
  position integer not null default 0,
  wip_limit integer default 0,  -- 0 means no limit
  color text default '#3B82F6',
  is_done_column boolean default false,
  created_at timestamptz default now()
);

-- =====================================================================
-- TASKS (universal work item: story, task, bug, milestone, ticket)
-- =====================================================================
create table if not exists tasks (
  id uuid primary key default uuid_generate_v4(),
  project_id uuid references projects(id) on delete cascade,
  sprint_id uuid references sprints(id) on delete set null,
  column_id uuid references kanban_columns(id) on delete set null,
  parent_id uuid references tasks(id) on delete set null,
  title text not null,
  description text,
  type text not null default 'task' check (type in ('epic','story','task','bug','milestone','ticket')),
  priority text not null default 'medium' check (priority in ('low','medium','high','critical')),
  status text not null default 'todo' check (status in ('todo','in_progress','review','done','blocked','cancelled')),
  story_points numeric(5,2) default 0,
  progress integer default 0 check (progress between 0 and 100),
  assignee_id uuid references users(id) on delete set null,
  reporter_id uuid references users(id) on delete set null,
  start_date date,
  due_date date,
  actual_start date,
  actual_end date,
  estimated_hours numeric(7,2) default 0,
  actual_hours numeric(7,2) default 0,
  is_milestone boolean default false,
  is_critical_path boolean default false,
  slack_days integer default 0,
  position integer default 0,
  created_at timestamptz default now(),
  updated_at timestamptz default now()
);

create index if not exists idx_tasks_project on tasks(project_id);
create index if not exists idx_tasks_sprint on tasks(sprint_id);
create index if not exists idx_tasks_column on tasks(column_id);
create index if not exists idx_tasks_assignee on tasks(assignee_id);

-- =====================================================================
-- DEPENDENCIES (PMI - FS, SS, FF, SF)
-- =====================================================================
create table if not exists task_dependencies (
  id uuid primary key default uuid_generate_v4(),
  predecessor_id uuid references tasks(id) on delete cascade,
  successor_id uuid references tasks(id) on delete cascade,
  dep_type text not null default 'FS' check (dep_type in ('FS','SS','FF','SF')),
  lag_days integer default 0,
  created_at timestamptz default now(),
  unique(predecessor_id, successor_id)
);

-- =====================================================================
-- BASELINES (PMI baselines - up to 3 per project)
-- =====================================================================
create table if not exists baselines (
  id uuid primary key default uuid_generate_v4(),
  project_id uuid references projects(id) on delete cascade,
  name text not null,
  version integer not null,
  snapshot jsonb not null,  -- frozen tasks + dates + costs
  notes text,
  created_by uuid references users(id) on delete set null,
  created_at timestamptz default now()
);

-- =====================================================================
-- ITIL: TICKETS & SLA
-- =====================================================================
create table if not exists sla_policies (
  id uuid primary key default uuid_generate_v4(),
  name text not null,
  priority text not null unique check (priority in ('low','medium','high','critical')),
  response_minutes integer not null,
  resolution_minutes integer not null,
  escalation_threshold_percent integer default 80,
  created_at timestamptz default now()
);

create table if not exists itil_tickets (
  id uuid primary key default uuid_generate_v4(),
  code text unique not null,
  project_id uuid references projects(id) on delete set null,
  title text not null,
  description text,
  ticket_type text not null default 'incident' check (ticket_type in ('incident','request','problem','change')),
  priority text not null default 'medium' check (priority in ('low','medium','high','critical')),
  status text not null default 'open' check (status in ('open','in_progress','pending','resolved','closed')),
  reporter_id uuid references users(id) on delete set null,
  assignee_id uuid references users(id) on delete set null,
  opened_at timestamptz default now(),
  first_response_at timestamptz,
  resolved_at timestamptz,
  sla_response_due timestamptz,
  sla_resolution_due timestamptz,
  sla_breached boolean default false,
  escalated boolean default false,
  created_at timestamptz default now(),
  updated_at timestamptz default now()
);

create index if not exists idx_tickets_status on itil_tickets(status);
create index if not exists idx_tickets_priority on itil_tickets(priority);

-- =====================================================================
-- EVENTS (audit + CFD/WIP overflow tracking)
-- =====================================================================
create table if not exists events (
  id uuid primary key default uuid_generate_v4(),
  project_id uuid references projects(id) on delete cascade,
  entity_type text not null,
  entity_id uuid,
  event_type text not null,  -- status_change, wip_overflow, dependency_shift, sla_breach...
  payload jsonb,
  created_by uuid references users(id) on delete set null,
  created_at timestamptz default now()
);

create index if not exists idx_events_project on events(project_id);
create index if not exists idx_events_type on events(event_type);

-- =====================================================================
-- SEED DATA: default SLA policies
-- =====================================================================
insert into sla_policies (name, priority, response_minutes, resolution_minutes, escalation_threshold_percent) values
  ('Critical SLA', 'critical', 15, 240, 80),
  ('High SLA', 'high', 60, 480, 80),
  ('Medium SLA', 'medium', 240, 1440, 80),
  ('Low SLA', 'low', 480, 2880, 80)
on conflict (priority) do nothing;

-- =====================================================================
-- SEED DATA: sample project + columns
-- =====================================================================
insert into users (email, full_name, role) values
  ('admin@company.com', 'System Admin', 'admin'),
  ('pm@company.com', 'Jane PM', 'pm'),
  ('dev@company.com', 'John Dev', 'dev')
on conflict (email) do nothing;

insert into projects (code, name, description, methodology, status, start_date, end_date, budget)
values ('P-001', 'Plataforma Demo', 'Proyecto demo híbrido Agile + PMI + ITIL', 'hybrid', 'active', current_date, current_date + interval '90 days', 150000)
on conflict (code) do nothing;

-- Default kanban columns for all existing projects
do $$
declare
  p record;
begin
  for p in select id from projects loop
    if not exists (select 1 from kanban_columns where project_id = p.id) then
      insert into kanban_columns (project_id, name, position, wip_limit, color, is_done_column) values
        (p.id, 'Backlog', 0, 0, '#6B7280', false),
        (p.id, 'To Do', 1, 5, '#3B82F6', false),
        (p.id, 'In Progress', 2, 3, '#F59E0B', false),
        (p.id, 'Review', 3, 2, '#8B5CF6', false),
        (p.id, 'Done', 4, 0, '#10B981', true);
    end if;
  end loop;
end $$;

-- =====================================================================
-- RLS (Row Level Security) - enable if using Supabase Auth
-- =====================================================================
-- alter table projects enable row level security;
-- alter table tasks enable row level security;
-- alter table itil_tickets enable row level security;
-- (Policies should be added based on your auth model)

-- End of schema
