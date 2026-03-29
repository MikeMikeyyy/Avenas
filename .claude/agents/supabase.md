---
description: >
  Supabase configuration and database schema for the Avenas app.
  Read this before writing any database queries, auth logic, or
  Supabase-related code. Never guess at table or column names — use
  this file as the source of truth.
---

# Avenas — Supabase Agent

## Connection Config

These values live in a `.env` file at the root of the avenas/ project.
Never hardcode them directly in source files.

```
EXPO_PUBLIC_SUPABASE_URL=YOUR_PROJECT_URL_HERE
EXPO_PUBLIC_SUPABASE_ANON_KEY=YOUR_ANON_KEY_HERE
```

**Project Region:** Asia-Pacific
**RLS:** Enabled on all tables

---

## Supabase Client Setup

File: `lib/supabase.ts`

```typescript
import { createClient } from '@supabase/supabase-js';

const supabaseUrl = process.env.EXPO_PUBLIC_SUPABASE_URL!;
const supabaseAnonKey = process.env.EXPO_PUBLIC_SUPABASE_ANON_KEY!;

export const supabase = createClient(supabaseUrl, supabaseAnonKey);
```

---

## Database Schema

### `profiles` table
Extends Supabase auth.users. Created automatically on sign up via trigger.

| Column | Type | Notes |
|--------|------|-------|
| id | uuid | Primary key, references auth.users.id |
| created_at | timestamptz | Auto |
| full_name | text | User's display name |
| username | text | Unique username |
| avatar_url | text | Profile photo URL |
| account_type | text | 'gym_goer' or 'pt' |
| bio | text | Optional, PT bio |

---

### `workouts` table
A logged workout session.

| Column | Type | Notes |
|--------|------|-------|
| id | uuid | Primary key |
| created_at | timestamptz | Auto |
| user_id | uuid | References profiles.id |
| name | text | e.g. "Monday Push Day" |
| notes | text | Optional session notes |
| duration_minutes | int | Total workout duration |
| completed_at | timestamptz | When the session ended |

---

### `exercises` table
Exercises within a workout session.

| Column | Type | Notes |
|--------|------|-------|
| id | uuid | Primary key |
| workout_id | uuid | References workouts.id |
| name | text | e.g. "Bench Press" |
| order | int | Order within the workout |
| notes | text | Optional exercise notes |

---

### `sets` table
Individual sets within an exercise.

| Column | Type | Notes |
|--------|------|-------|
| id | uuid | Primary key |
| exercise_id | uuid | References exercises.id |
| set_number | int | e.g. 1, 2, 3 |
| reps | int | Number of reps |
| weight_kg | numeric | Weight in kg |
| completed | boolean | Whether set was completed |

---

### `programs` table
A workout program (collection of planned workouts).

| Column | Type | Notes |
|--------|------|-------|
| id | uuid | Primary key |
| created_at | timestamptz | Auto |
| created_by | uuid | References profiles.id |
| name | text | Program name |
| description | text | Optional description |
| is_template | boolean | Whether it's a reusable template |
| duration_weeks | int | How many weeks the program runs |

---

### `program_workouts` table
Planned workouts within a program.

| Column | Type | Notes |
|--------|------|-------|
| id | uuid | Primary key |
| program_id | uuid | References programs.id |
| name | text | e.g. "Day 1 — Push" |
| day_of_week | int | 0=Mon, 6=Sun |
| week_number | int | Which week of the program |
| order | int | Order within the day |

---

### `program_exercises` table
Exercises planned within a program workout.

| Column | Type | Notes |
|--------|------|-------|
| id | uuid | Primary key |
| program_workout_id | uuid | References program_workouts.id |
| name | text | Exercise name |
| sets | int | Planned number of sets |
| reps | text | e.g. "8-12" or "5" |
| weight_notes | text | e.g. "RPE 8" or "70% 1RM" |
| order | int | Order within the workout |

---

### `client_pt_relationships` table
Links gym goers to their personal trainers.

| Column | Type | Notes |
|--------|------|-------|
| id | uuid | Primary key |
| created_at | timestamptz | Auto |
| pt_id | uuid | References profiles.id (must be account_type='pt') |
| client_id | uuid | References profiles.id |
| status | text | 'pending', 'active', 'declined' |

---

### `program_shares` table
Tracks programs shared between PT and client.

| Column | Type | Notes |
|--------|------|-------|
| id | uuid | Primary key |
| created_at | timestamptz | Auto |
| program_id | uuid | References programs.id |
| shared_by | uuid | References profiles.id |
| shared_with | uuid | References profiles.id |
| status | text | 'pending', 'accepted', 'declined' |
| is_personalised | boolean | True if made specifically for this client |

---

### `messages` table
PT ↔ client messaging.

| Column | Type | Notes |
|--------|------|-------|
| id | uuid | Primary key |
| created_at | timestamptz | Auto |
| sender_id | uuid | References profiles.id |
| receiver_id | uuid | References profiles.id |
| content | text | Message content |
| read | boolean | Whether message has been read |

---

## RLS Policies (apply to all tables)

- Users can only read and write their own data
- PTs can read data belonging to their active clients
- Clients can read programs shared with them
- Messages visible only to sender and receiver

---

## Auth Flow

- Sign up → Supabase creates auth.users entry → trigger creates profiles row
- Account type (gym_goer or pt) set during onboarding and stored in profiles.account_type
- Use `supabase.auth.getSession()` to check if user is logged in
- Use `supabase.auth.signOut()` to log out

---

## Key Queries Reference

**Get current user profile:**
```typescript
const { data: profile } = await supabase
  .from('profiles')
  .select('*')
  .eq('id', supabase.auth.getUser().data.user?.id)
  .single();
```

**Get user's workouts:**
```typescript
const { data: workouts } = await supabase
  .from('workouts')
  .select('*, exercises(*, sets(*))')
  .eq('user_id', userId)
  .order('completed_at', { ascending: false });
```

**Get PT's active clients:**
```typescript
const { data: clients } = await supabase
  .from('client_pt_relationships')
  .select('*, client:profiles!client_id(*)')
  .eq('pt_id', ptId)
  .eq('status', 'active');
```
