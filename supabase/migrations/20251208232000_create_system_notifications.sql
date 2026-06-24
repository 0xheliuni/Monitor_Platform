create table system_notifications (
  id uuid primary key default gen_random_uuid(),
  message text not null,
  is_active boolean default true,
  level text default 'info',
  created_at timestamptz default now()
);

-- Enable RLS
alter table system_notifications enable row level security;

-- Policy for reading notifications (public access)
create policy "Allow public read access"
  on system_notifications
  for select
  using (true);

-- Policy for inserting/updating/deleting (authenticated users only, or just service role if no auth set up yet)
-- For now, we'll allow public read. Write is restricted implicitly to service_role unless policies are added.
