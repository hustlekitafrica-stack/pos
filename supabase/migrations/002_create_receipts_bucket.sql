-- Create receipts storage bucket for receipt images
insert into storage.buckets (id, name, public)
values ('receipts', 'receipts', true)
on conflict (id) do nothing;

-- Grant public read access
create policy "Public Read" on storage.objects
for select
using (bucket_id = 'receipts');

-- Grant authenticated users upload access
create policy "Authenticated Upload" on storage.objects
for insert
with check (bucket_id = 'receipts' and auth.role() = 'authenticated');

-- Grant authenticated users update access (for upsert)
create policy "Authenticated Update" on storage.objects
for update
with check (bucket_id = 'receipts' and auth.role() = 'authenticated');
