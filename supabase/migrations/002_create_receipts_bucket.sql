-- Create receipts storage bucket for receipt images
insert into storage.buckets (id, name, public)
values ('receipts', 'receipts', true)
on conflict (id) do nothing;

-- Grant public read access
drop policy if exists "Public Read" on storage.objects;
create policy "Public Read" on storage.objects
for select
using (bucket_id = 'receipts');

-- Grant authenticated users upload access
drop policy if exists "Authenticated Upload" on storage.objects;
create policy "Authenticated Upload" on storage.objects
for insert
with check (bucket_id = 'receipts' and auth.role() = 'authenticated');

-- Grant authenticated users update access (for upsert)
drop policy if exists "Authenticated Update" on storage.objects;
create policy "Authenticated Update" on storage.objects
for update
with check (bucket_id = 'receipts' and auth.role() = 'authenticated');
