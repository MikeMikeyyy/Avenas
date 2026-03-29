# Avenas — Task Tracker

> Read this at the start of every session to know exactly where we are.
> Update this as tasks are completed, started, or added.

---

## App Overview
- **App:** Avenas — gym tracking app
- **Stack:** React Native + Expo + TypeScript + Supabase
- **Build:** EAS Build → Apple App Store
- **Stage 1:** Core gym tracking (workout logging, journal, progress, programs)
- **Stage 2:** PT accounts (client management, program sharing, messaging)

## Account Types
- **Gym Goer** — workout tracking, journal, progress, programs, connect with PT
- **PT** — everything a Gym Goer has + Clients tab, program sharing/editing with clients, messaging

---

## Status Legend
- 🔴 Not started
- 🟡 In progress
- ✅ Done
- ⏸ Blocked / waiting

---

## Setup & Infrastructure
- ✅ Expo project initialised (`avenas/`)
- ✅ `.claude/` rules and skills configured (liquid glass, App Store compliance, workflow)
- 🔴 Supabase project created
- 🔴 Supabase tables defined (User, Workout, Exercise, Set, Program, Client relationship)
- 🔴 Supabase keys added to app config
- 🔴 `constants/theme.ts` created (colours, spacing, fonts)
- 🔴 EAS Build configured
- 🔴 TestFlight set up for device testing

## Navigation & Structure
- 🔴 Tab navigator set up with NativeTabs
- 🔴 Auth flow scaffolded (onboarding, login, sign up)
- 🔴 Account type routing (Gym Goer vs PT tabs)
- 🔴 All Stage 1 screens created as placeholders

## Auth Screens
- 🔴 Onboarding / Welcome screen
- 🔴 Sign Up (with account type selection — Gym Goer or PT)
- 🔴 Log In
- 🔴 Supabase auth connected

## Core Screens — Gym Goer & PT
- 🔴 Home Dashboard
- 🔴 Log Workout (active session)
- 🔴 Workout Journal (history)
- 🔴 Programs (create, view, edit)
- 🔴 Progress (stats, graphs, measurements)
- 🔴 Profile / Settings

## PT-Only Screens
- 🔴 Clients tab (manage clients, add clients)
- 🔴 Client detail (their progress, programs assigned)
- 🔴 Program sharing to clients
- 🔴 Two-way program editing (PT edits client programs, client sends programs to PT)
- 🔴 Messaging (PT ↔ client)

## Liquid Glass
- 🔴 GlassCard component created
- 🔴 GlassButton component created
- 🔴 GlassNavBar component created
- 🔴 GlassModal component created
- 🔴 NativeTabs configured for tab bar

## App Store
- 🔴 App icon finalised (not default Expo icon)
- 🔴 Splash screen finalised
- 🔴 Privacy policy written and hosted
- 🔴 Privacy policy linked in app and App Store Connect
- 🔴 Screenshots created for App Store listing
- 🔴 App Store compliance audit completed (see `.claude/rules/apple-appstore-compliance.md`)

---

## Current Session
> Update this section at the start of each session with what you're working on today.

**Last worked on:** Initial setup
**Next task:** Create Supabase project and define data models

---

## Completed This Week
> Move finished tasks here with a date so there's a record of progress.

- Project scaffolded and .claude config set up (29 Mar 2026)
