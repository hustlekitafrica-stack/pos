# Supabase Storage Setup for Receipt Images

This guide sets up a storage bucket to store receipt images.

## Step 1: Create Storage Bucket

1. Go to https://supabase.com/dashboard/project/rusopielhzmdyskrrkaw/storage
2. Click **"New bucket"**
3. Name it: `receipts`
4. Make it **Public** (so images can be displayed in the app)
5. Click **"Create bucket"**

## Step 2: Configure Bucket RLS (Optional)

If you want to restrict access:

1. Go to the `receipts` bucket
2. Click **"Policies"**
3. Add a policy to allow authenticated users to upload:
   - **Name**: `allow_upload`
   - **Allowed operations**: `INSERT`
   - **Target role**: `authenticated`
   - **Policy definition**: `bucket_id = 'receipts'`

4. Add a policy to allow public read:
   - **Name**: `allow_public_read`
   - **Allowed operations**: `SELECT`
   - **Target role**: `anon`
   - **Policy definition**: `bucket_id = 'receipts'`

## Step 3: Update App Code

The Expense model already has `receiptPhotoUrl` field. The app code will be updated to:
1. Upload image to Supabase Storage when scanning
2. Store the public URL in the expense record
3. Display the receipt image in the expense detail view

## Storage URL Format

Public URLs will be:
```
https://rusopielhzmdyskrrkaw.supabase.co/storage/v1/object/public/receipts/{filename}
```
