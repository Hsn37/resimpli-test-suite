# Resimpli Test Suite — Plan

Next.js app for testing Retell AI voice agents via real web calls. Deployed on Vercel.

---

## 1. Auth (Clerk)

Invite-only auth via Clerk. No self sign-up. Clerk middleware protects all routes server-side.

**Impl:** `clerkMiddleware()` in `middleware.ts` protects all routes. `<SignedOut>` redirects to Clerk's hosted sign-in. Self sign-up disabled in Clerk dashboard. Retell API key lives in `.env.local`, never exposed to the client.

## 2. Admin Page (User Management)

Admins can invite team members by email and manage existing users. No self sign-up — all access is invite-only. First admin is bootstrapped via a hardcoded email in code.

**Impl:** Admin page uses Clerk's Backend API (`@clerk/nextjs/server`) via API routes: `POST /api/admin/invite` creates an invitation, `GET /api/admin/users` lists users, `DELETE /api/admin/users/[id]` removes a user. Gate admin routes by checking the current user's email against an `ADMIN_EMAILS` env var. No Clerk Organizations needed.

## 3. Microphone Permissions

Prompt for mic access before connecting a call. Show clear states for denied/blocked/unavailable.

**Impl:** Call `navigator.mediaDevices.getUserMedia({ audio: true })` before initiating the web call. Show a permissions screen with three states: requesting, granted (proceed), denied (show instructions to unblock in browser settings). Release the stream immediately after the check — Retell SDK manages its own stream.

## 4. Agent Selection + Version Picker

After auth, show a list of agents from the account. Once selected, show a dropdown of its versions.

**Impl:** API route `GET /api/agents` calls Retell's `/list-agents` with the server-side API key. On select, `GET /api/agents/[id]` fetches versions. Render as a card list with version dropdown.

## 5. Dynamic Variable Presets

Hardcoded preset groups the user can pick from. Also allow dropping a JSON file to override/merge vars.

**Impl:** `presets.ts` const mapping preset names to `Record<string, string>`. Render preset chips + a dropzone (`onDrop` → `FileReader` → `JSON.parse` → merge into state). Editable JSON viewer for current vars.

## 6. Three Call Modes

- **Inbound** — simulates a caller dialing in; AI speaks first.
- **Outbound Follow-up** — simulates AI calling a lead back; user speaks first.
- **Speed to Lead** — simulates AI calling a new lead immediately; user speaks first.

These are simulated via UX + Retell's `first_speaker` param + dynamic variables. Web calls don't have real direction — this is for testing purposes.

**Impl:** Three tab buttons setting `callMode` state. Each mode maps to `{ direction, firstSpeaker, defaultPreset }`. Passed to the web call creation API route. Retell handles the wait/delay behavior natively based on `first_speaker`.

## 7. Web Call Creation

Create a Retell web call and connect via their browser SDK.

**Impl:** API route `POST /api/calls/create` calls Retell's `/create-web-call` with `agent_id`, `metadata`, `dynamic_variables` using the server-side key. Returns `access_token` + `call_id` to the client. Client initializes `RetellWebClient` and calls `startCall({ accessToken })`.

## 8. Call Animations & UX

- **Inbound:** Ringing animation + "Incoming call from Agent", auto-connect after ~2 rings.
- **Outbound:** Dialing animation + ring sound, "Pick Up" button.

**Impl:** State machine: `idle → ringing → connected → ended`. Inbound: `setTimeout` ~3s then auto-connect. Outbound: ring audio loop, green pickup button, on click connect. CSS keyframe animations.

## 9. Call ID Tracking

Display the active call ID during and after the call.

**Impl:** Store `callId` from create response. Render in a badge in the call header. Copy-to-clipboard on click.

## 10. Call History (localStorage)

Persist a log of past calls so they survive page refresh. Show a sidebar/list of recent calls with call ID, agent name, mode, timestamp, and duration.

**Impl:** On call end, append `{ callId, agentId, agentName, mode, timestamp, duration }` to a `localStorage` array. Render as a collapsible sidebar list. Clicking a past call fetches its metadata via `GET /api/calls/[id]` for download.

## 11. Post-Call Metadata Download

After call ends, fetch full call data and download as `{call_id}.json`.

**Impl:** API route `GET /api/calls/[id]` fetches from Retell's `/get-call/{call_id}`. Returns transcript, tool calls, analysis, annotations. "Download" button → `Blob` → `URL.createObjectURL` → `<a download="{call_id}.json">`.

## 12. Live Call UI

During an active call, show:
- Pulsing animation for who's speaking
- Mute / end call buttons
- Call duration timer
- Current dynamic variables (live-updated)

**Impl:** Listen to `RetellWebClient` events: `audio_level`, `call_started`, `call_ended`, `agent_start_talking`, `agent_stop_talking`. Pulse animation scaled by audio level. Mute via `client.mute()`, end via `client.stopCall()`. Timer via `setInterval`.

## 13. Error Handling & Banners

Toast/banner system for errors and status updates throughout the app.

**Impl:** Lightweight toast component (auto-dismiss after 5s, manual dismiss). Used for: call creation failure, SDK disconnect, mic permission denied, API errors, Retell service errors. On mid-call disconnect, show a "Call disconnected" banner with the call ID so the user can still download metadata.

---

## Tech Stack

- Next.js 15 (App Router)
- Tailwind CSS
- Lucide React (icons)
- `@clerk/nextjs` (auth + middleware + Backend API for invites)
- `retell-client-js-sdk` (web call SDK, client-side)
- Vercel (deployment)

## File Structure

```
resimpli_test_suite/
├── .env.local                # RETELL_API_KEY, NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY, CLERK_SECRET_KEY, ADMIN_EMAILS
├── next.config.js
├── tailwind.config.js
├── postcss.config.js
├── package.json
├── middleware.ts             # Clerk auth middleware
├── app/
│   ├── layout.tsx            # ClerkProvider wrapper
│   ├── page.tsx              # Main page — agent select + call setup + call
│   ├── admin/
│   │   └── page.tsx          # Admin — invite/manage users
│   ├── sign-in/[[...sign-in]]/
│   │   └── page.tsx          # Clerk sign-in page
│   └── api/
│       ├── agents/
│       │   ├── route.ts      # GET — list agents
│       │   └── [id]/
│       │       └── route.ts  # GET — get agent + versions
│       ├── calls/
│       │   ├── create/
│       │   │   └── route.ts  # POST — create web call
│       │   └── [id]/
│       │       └── route.ts  # GET — get call metadata
│       └── admin/
│           ├── invite/
│           │   └── route.ts  # POST — invite user by email
│           └── users/
│               ├── route.ts  # GET — list users
│               └── [id]/
│                   └── route.ts  # DELETE — remove user
├── components/
│   ├── AgentSelect.tsx
│   ├── CallSetup.tsx
│   ├── CallScreen.tsx
│   ├── CallHistory.tsx
│   ├── MicPermission.tsx
│   ├── VarEditor.tsx
│   ├── JsonDropzone.tsx
│   ├── RingingAnimation.tsx
│   ├── AudioVisualizer.tsx
│   ├── CallTimer.tsx
│   └── Toast.tsx
├── lib/
│   ├── retell.ts             # Server-side Retell API helper
│   ├── presets.ts            # Hardcoded variable presets
│   └── callHistory.ts       # localStorage helper for call log
└── public/
    └── ring.mp3
```

## Build Order

1. Scaffold project (`create-next-app` + Tailwind + Clerk + retell-client-js-sdk)
2. Clerk auth (middleware + sign-in page + provider)
3. Admin page (invite by email, list/remove users via Clerk Backend API)
4. Toast/banner component
5. API routes for agents + calls (server-side Retell proxy)
6. Agent list + version picker
7. Call setup screen (mode selector + presets + JSON drop)
8. Mic permissions check
9. Web call integration (create call + SDK connect)
10. Call animations (ringing, pickup, connected states)
11. Live call UI (visualizer, mute, timer, end)
12. Call history (localStorage)
13. Post-call download
14. Error handling pass (wire toasts to all failure points)
15. Deploy to Vercel
