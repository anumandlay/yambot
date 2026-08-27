/**
 * @fileoverview Agent action reference — human-readable guide for all worker action types.
 * Purpose: Help users write goal/chat instructions that mention the right actions.
 * Inputs: Mirrors worker/src/actions.js ACTION_TYPES (keep in sync when actions are added).
 * Downstream: AgentActionsPage.jsx
 */

/**
 * @typedef {{
 *   id: string,
 *   title: string,
 *   summary: string,
 *   whenToUse: string,
 *   savesTo: string,
 *   exampleInstruction: string,
 *   exampleJson: string,
 * }} AgentActionEntry
 */

/**
 * @typedef {{
 *   id: string,
 *   title: string,
 *   intro: string,
 *   actions: AgentActionEntry[],
 * }} AgentActionSection
 */

/** @type {AgentActionSection[]} */
export const AGENT_ACTION_SECTIONS = [
  {
    id: "browser",
    title: "Browser & page control",
    intro: "Move around the web like a person — open URLs, click, type, scroll. Use these in almost every goal.",
    actions: [
      {
        id: "navigate",
        title: "navigate",
        summary: "Go to a URL in the agent's Chromium browser.",
        whenToUse: "Starting a task, opening a new site, jumping to pricing/login/checkout pages.",
        savesTo: "Browser only (no database write).",
        exampleInstruction: "Navigate to https://vughy.com/pricing and wait for the page to load.",
        exampleJson: '{ "type": "navigate", "url": "https://vughy.com/pricing" }',
      },
      {
        id: "click",
        title: "click",
        summary: "Click a button, link, or control on the page.",
        whenToUse: "Submit forms, accept cookies, open menus, follow search results.",
        savesTo: "Browser only.",
        exampleInstruction: "Click the “Contact us” button, then extract the email shown.",
        exampleJson: '{ "type": "click", "ref": "e12", "role": "button", "name": "Contact us" }',
      },
      {
        id: "type",
        title: "type",
        summary: "Type text into an input or contenteditable field.",
        whenToUse: "Search boxes, login fields, chat compose, form fields.",
        savesTo: "Browser only.",
        exampleInstruction: "Type “travel agency California” into Google search and press Enter.",
        exampleJson: '{ "type": "type", "ref": "e5", "text": "travel agency California", "submit": true }',
      },
      {
        id: "select",
        title: "select",
        summary: "Pick an option from a dropdown.",
        whenToUse: "Country selectors, plan tiers, native <select> elements.",
        savesTo: "Browser only.",
        exampleInstruction: "Select “United States” from the country dropdown before submitting.",
        exampleJson: '{ "type": "select", "ref": "e8", "value": "United States" }',
      },
      {
        id: "press_key",
        title: "press_key",
        summary: "Send keyboard keys (Enter, Tab, Escape, arrows).",
        whenToUse: "Submit without clicking, close modals, keyboard shortcuts.",
        savesTo: "Browser only.",
        exampleInstruction: "After typing the search query, press Enter to search.",
        exampleJson: '{ "type": "press_key", "key": "Enter" }',
      },
      {
        id: "scroll",
        title: "scroll",
        summary: "Scroll the page or a sidebar panel.",
        whenToUse: "Content below the fold, long menus (e.g. Vughy nav), infinite lists.",
        savesTo: "Browser only.",
        exampleInstruction: "Scroll down to load more search results before extracting leads.",
        exampleJson: '{ "type": "scroll", "direction": "down", "amount": 600 }',
      },
      {
        id: "extract",
        title: "extract",
        summary: "Read and summarize visible page content (prices, text, tables).",
        whenToUse: "Competitor pricing, agency contact info, article research — before finish.",
        savesTo: "Chat reply (via agent summary); combine with create_entity to persist.",
        exampleInstruction: "Extract all plan names and prices visible on the pricing page.",
        exampleJson: '{ "type": "extract", "focus": "plan names and monthly prices" }',
      },
      {
        id: "solve_captcha",
        title: "solve_captcha",
        summary: "Attempt automated CAPTCHA solving (DeathByCaptcha if configured).",
        whenToUse: "Simple text CAPTCHAs when DBC credentials exist in Settings.",
        savesTo: "Browser session only.",
        exampleInstruction: "If a CAPTCHA appears, try solve_captcha once; otherwise ask_user.",
        exampleJson: '{ "type": "solve_captcha" }',
      },
    ],
  },
  {
    id: "wait-tabs",
    title: "Wait & tabs",
    intro: "Timing and multi-page workflows.",
    actions: [
      {
        id: "wait",
        title: "wait",
        summary: "Pause for a fixed number of milliseconds.",
        whenToUse: "Short delays only — prefer wait_for when you know what should appear.",
        savesTo: "Nothing.",
        exampleInstruction: "After clicking Submit, wait briefly then verify success message.",
        exampleJson: '{ "type": "wait", "ms": 800 }',
      },
      {
        id: "wait_for",
        title: "wait_for",
        summary: "Wait until a condition is true (text, URL, dialog, element visible).",
        whenToUse: "Page loads, checkout confirmation, modal appearance — more reliable than blind wait.",
        savesTo: "Nothing.",
        exampleInstruction: "Wait until URL contains /dashboard before continuing.",
        exampleJson:
          '{ "type": "wait_for", "url_contains": "/dashboard", "timeout_ms": 15000 }',
      },
      {
        id: "open_tab",
        title: "open_tab",
        summary: "Navigate to a URL (same window; YamBot avoids extra tabs when possible).",
        whenToUse: "Open a linked site while keeping context — often same as navigate.",
        savesTo: "Browser only.",
        exampleInstruction: "Open each agency website from the Google results list.",
        exampleJson: '{ "type": "open_tab", "url": "https://example-agency.com" }',
      },
      {
        id: "switch_tab",
        title: "switch_tab",
        summary: "Switch to another open browser tab by index or URL fragment.",
        whenToUse: "Multiple tabs already open (legacy flows).",
        savesTo: "Browser only.",
        exampleInstruction: "Switch to the tab whose URL contains “checkout”.",
        exampleJson: '{ "type": "switch_tab", "url_contains": "checkout" }',
      },
    ],
  },
  {
    id: "forms",
    title: "Forms, files & dialogs",
    intro: "Bulk form filling and file uploads.",
    actions: [
      {
        id: "fill_form",
        title: "fill_form",
        summary: "Fill several fields in one form at once.",
        whenToUse: "Login pages, registration, multi-field applications.",
        savesTo: "Browser only (unless submit triggers a server-side record elsewhere).",
        exampleInstruction: "Fill the contact form with name, email, and message; ask_user before submit.",
        exampleJson:
          '{ "type": "fill_form", "form": "contact", "fields": { "Name": "Jane", "Email": "j@co.com" }, "submit": false }',
      },
      {
        id: "upload_file",
        title: "upload_file",
        summary: "Upload a file through a file input on the page.",
        whenToUse: "Job applications, document portals, attach resume/PDF.",
        savesTo: "Target website (file from agent uploads folder on cloud computer).",
        exampleInstruction: "Upload invoice.pdf to the portal’s file input.",
        exampleJson: '{ "type": "upload_file", "ref": "e5", "path": "invoice.pdf" }',
      },
      {
        id: "dismiss_dialog",
        title: "dismiss_dialog",
        summary: "Close cookie banners, promo modals, alert dialogs.",
        whenToUse: "Before clicking main content blocked by overlays.",
        savesTo: "Nothing.",
        exampleInstruction: "Dismiss any cookie consent dialog before navigating the site.",
        exampleJson: '{ "type": "dismiss_dialog", "button": "Accept" }',
      },
      {
        id: "choose_menu_item",
        title: "choose_menu_item",
        summary: "Click through nested menu paths (File → Export → PDF).",
        whenToUse: "App-style menus already open.",
        savesTo: "Browser only.",
        exampleInstruction: "Open Export menu and choose PDF download.",
        exampleJson: '{ "type": "choose_menu_item", "path": ["File", "Export", "PDF"] }',
      },
    ],
  },
  {
    id: "human",
    title: "Human help & completion",
    intro: "When the agent needs you, or the task is done.",
    actions: [
      {
        id: "ask_user",
        title: "ask_user",
        summary: "Pause and ask you a question in chat (or Take control for CAPTCHA).",
        whenToUse: "Login approval, ambiguous decisions, image CAPTCHAs, before risky submit.",
        savesTo: "Chat thread (waiting_user task until you answer).",
        exampleInstruction: "Before placing the order, ask_user for confirmation.",
        exampleJson: '{ "type": "ask_user", "question": "Proceed with purchase $199?" }',
      },
      {
        id: "finish",
        title: "finish",
        summary: "End the run and post the final summary to chat.",
        whenToUse: "Always — every successful task should finish with a clear summary.",
        savesTo: "Chat message. Include KPI: name +1 lines here to bump goal counters.",
        exampleInstruction: "When done, finish with a summary listing each agency found. Include KPI: leads_found +1 per agency.",
        exampleJson:
          '{ "type": "finish", "summary": "Found 3 agencies… KPI: leads_found +3", "success": true }',
      },
      {
        id: "request_training",
        title: "request_training",
        summary: "File a request for a human to teach a new skill/workflow.",
        whenToUse: "Agent is stuck on an unknown UI; appears on Skills → training requests.",
        savesTo: "Skills training queue (not CRM).",
        exampleInstruction: "If the portal layout is unknown, request_training describing what failed.",
        exampleJson:
          '{ "type": "request_training", "workflow": "Vughy admin export", "observation": "No export button found" }',
      },
    ],
  },
  {
    id: "crm",
    title: "Company / CRM database",
    intro: "Persist leads and customers — saved under Company → Entities in MongoDB.",
    actions: [
      {
        id: "search_entities",
        title: "search_entities",
        summary: "Search your existing Company records (leads, customers, etc.).",
        whenToUse: "Before create_entity — avoid duplicate leads; look up prior contacts.",
        savesTo: "Reads database only.",
        exampleInstruction: "Before saving, search_entities for the agency name to skip duplicates.",
        exampleJson:
          '{ "type": "search_entities", "query": "Sunshine Travel", "type_filter": "lead", "limit": 5 }',
      },
      {
        id: "get_entity",
        title: "get_entity",
        summary: "Load one entity by ID.",
        whenToUse: "Follow-up tasks when you already have the record ID from a prior run.",
        savesTo: "Reads database only.",
        exampleInstruction: "Get entity abc123 and add today’s call notes.",
        exampleJson: '{ "type": "get_entity", "entityId": "6789abc..." }',
      },
      {
        id: "create_entity",
        title: "create_entity",
        summary: "Create a new lead/customer record in Company.",
        whenToUse: "Sales prospecting — save each new agency/contact you find on the web.",
        savesTo: "Company → Entities (MongoDB).",
        exampleInstruction:
          "For each new agency: create_entity with name, type lead, attributes { city, email, website }.",
        exampleJson:
          '{ "type": "create_entity", "name": "Sunshine Travel", "type_filter": "lead", "attributes": { "city": "LA", "email": "info@sun.com" } }',
      },
      {
        id: "update_entity",
        title: "update_entity",
        summary: "Update fields or status on an existing entity.",
        whenToUse: "Lead became a customer, tier changed, corrected email after research.",
        savesTo: "Company → Entities (updates MongoDB).",
        exampleInstruction: "After demo booked, update_entity status to qualified.",
        exampleJson:
          '{ "type": "update_entity", "entityId": "...", "status": "qualified", "attributes": { "tier": "gold" } }',
      },
      {
        id: "add_entity_observation",
        title: "add_entity_observation",
        summary: "Append a timestamped note to an entity’s timeline.",
        whenToUse: "Call outcomes, pricing quotes, “no answer” — audit trail without changing core fields.",
        savesTo: "Entity.observations in MongoDB.",
        exampleInstruction: "Add observation: “Called Mar 5, left voicemail” on the lead.",
        exampleJson:
          '{ "type": "add_entity_observation", "entityId": "...", "content": "Called — left voicemail", "kind": "call" }',
      },
      {
        id: "set_entity_status",
        title: "set_entity_status",
        summary: "Change entity status (active, converted, churned, etc.).",
        whenToUse: "Pipeline stage changes in CRM workflows.",
        savesTo: "Company → Entities.",
        exampleInstruction: "When they sign up for Vughy trial, set_entity_status to converted.",
        exampleJson: '{ "type": "set_entity_status", "entityId": "...", "status": "converted" }',
      },
      {
        id: "assign_entity",
        title: "assign_entity",
        summary: "Assign an entity to a specific agent.",
        whenToUse: "Workforce routing — hand lead to outbound agent.",
        savesTo: "Company → Entities (relatedAgents).",
        exampleInstruction: "Assign hot leads to the outbound sales agent.",
        exampleJson: '{ "type": "assign_entity", "entityId": "...", "agentId": "..." }',
      },
    ],
  },
  {
    id: "goals",
    title: "Goals & KPIs",
    intro: "Track progress on Scheduled goals.",
    actions: [
      {
        id: "update_kpi",
        title: "update_kpi",
        summary: "Increment (or set) a KPI counter on a linked Goal.",
        whenToUse: "After each lead saved, check completed, email sent — pairs with Goal autonomy.",
        savesTo: "Goal document (kpis[].current in MongoDB). goalId auto-filled from task.",
        exampleInstruction: "After each new agency saved, update_kpi kpiName leads_found delta 1.",
        exampleJson: '{ "type": "update_kpi", "kpiName": "leads_found", "delta": 1 }',
      },
    ],
  },
  {
    id: "email",
    title: "Email",
    intro: "Requires agent email (SMTP/IMAP) configured on the agent edit page.",
    actions: [
      {
        id: "send_email",
        title: "send_email",
        summary: "Send an email via the agent’s SMTP identity.",
        whenToUse: "Outreach, follow-ups, verification codes — prefer over Gmail web UI when SMTP set.",
        savesTo: "Recipient inbox + chat log; may link entityId for threading.",
        exampleInstruction: "Send intro email to each new lead using the Vughy pitch from company memory.",
        exampleJson:
          '{ "type": "send_email", "to": "info@agency.com", "subject": "Vughy for agencies", "text": "…" }',
      },
      {
        id: "check_email",
        title: "check_email",
        summary: "Read recent inbox messages (IMAP).",
        whenToUse: "Wait for replies, read verification codes, support inbox monitoring.",
        savesTo: "Chat summary only (unless you create_entity from replies).",
        exampleInstruction: "Check inbox for unseen replies from leads contacted yesterday.",
        exampleJson: '{ "type": "check_email", "limit": 10, "unseenOnly": true }',
      },
    ],
  },
  {
    id: "support",
    title: "Support & tickets",
    intro: "Help desk workflows on Queues / ticket detail pages.",
    actions: [
      {
        id: "search_tickets",
        title: "search_tickets",
        summary: "Find support tickets by query or status.",
        whenToUse: "Triage open tickets, find duplicates, daily support sweep goals.",
        savesTo: "Reads ticket database.",
        exampleInstruction: "Search open tickets mentioning “login” and summarize each.",
        exampleJson: '{ "type": "search_tickets", "query": "login", "status": "open", "limit": 10 }',
      },
      {
        id: "create_ticket",
        title: "create_ticket",
        summary: "Open a new support ticket.",
        whenToUse: "Agent finds a customer issue while browsing; escalate from monitoring goals.",
        savesTo: "Tickets in MongoDB + Queues page.",
        exampleInstruction: "If the status page shows an outage, create_ticket with details.",
        exampleJson:
          '{ "type": "create_ticket", "title": "Site down", "description": "500 on /pricing", "priority": "high" }',
      },
      {
        id: "update_ticket",
        title: "update_ticket",
        summary: "Change ticket status or assignee.",
        whenToUse: "Resolve, escalate, or reassign during support goals.",
        savesTo: "Tickets in MongoDB.",
        exampleInstruction: "After verifying fix, update_ticket status to resolved.",
        exampleJson:
          '{ "type": "update_ticket", "ticketId": "...", "status": "resolved", "assigneeAgentId": "..." }',
      },
    ],
  },
  {
    id: "sales",
    title: "Sales, deals & billing",
    intro: "Pipeline and invoice operations.",
    actions: [
      {
        id: "search_deals",
        title: "search_deals",
        summary: "Search deals by pipeline stage.",
        whenToUse: "Sales review goals — “list all proposal-stage deals”.",
        savesTo: "Reads deals database.",
        exampleInstruction: "Search deals in proposal stage and note amounts in summary.",
        exampleJson: '{ "type": "search_deals", "stage": "proposal" }',
      },
      {
        id: "update_invoice",
        title: "update_invoice",
        summary: "Update invoice status (sent, paid, etc.).",
        whenToUse: "Billing follow-up after payment confirmed on a portal.",
        savesTo: "Invoices in MongoDB.",
        exampleInstruction: "When payment shows paid in Stripe, update_invoice status to paid.",
        exampleJson: '{ "type": "update_invoice", "invoiceId": "...", "status": "paid" }',
      },
    ],
  },
  {
    id: "processes",
    title: "Campaigns & processes",
    intro: "Multi-step workflows and campaign enrollments.",
    actions: [
      {
        id: "update_enrollment",
        title: "update_enrollment",
        summary: "Move a campaign enrollment to a new stage.",
        whenToUse: "After send_email — mark sent, awaiting_reply, engaged.",
        savesTo: "Campaign enrollment records.",
        exampleInstruction: "After confirmed email send, update_enrollment stage to sent.",
        exampleJson: '{ "type": "update_enrollment", "enrollmentId": "...", "stage": "sent" }',
      },
      {
        id: "start_process",
        title: "start_process",
        summary: "Start a documented SOP/process instance for an entity.",
        whenToUse: "Kick off onboarding, support, or sales playbooks from Company → Processes.",
        savesTo: "Process instances in MongoDB.",
        exampleInstruction: "When lead qualifies, start_process for onboarding SOP on that entity.",
        exampleJson:
          '{ "type": "start_process", "definitionId": "...", "entityId": "...", "note": "Demo booked" }',
      },
      {
        id: "advance_process",
        title: "advance_process",
        summary: "Move a running process to the next stage.",
        whenToUse: "Step-by-step SOP automation after browser steps complete.",
        savesTo: "Process instances in MongoDB.",
        exampleInstruction: "After contract signed on site, advance_process stage to closed_won.",
        exampleJson:
          '{ "type": "advance_process", "instanceId": "...", "stage": "closed_won", "status": "completed" }',
      },
    ],
  },
  {
    id: "integrations",
    title: "Integrations & API",
    intro: "Notify external systems without browser clicks.",
    actions: [
      {
        id: "send_slack",
        title: "send_slack",
        summary: "Post a message to Slack via webhook.",
        whenToUse: "Alert team when goal completes, lead found, or outage detected.",
        savesTo: "Slack channel (uses Company memory slack_webhook_url).",
        exampleInstruction: "When KPI target hit, send_slack “Campaign reached 50 leads”.",
        exampleJson: '{ "type": "send_slack", "text": "Goal reached 50 leads!" }',
      },
      {
        id: "send_webhook",
        title: "send_webhook",
        summary: "POST JSON to any webhook URL.",
        whenToUse: "Zapier, internal tools, custom automations.",
        savesTo: "External system (your webhook endpoint).",
        exampleInstruction: "On finish, send_webhook with lead payload to our CRM bridge.",
        exampleJson:
          '{ "type": "send_webhook", "payload": { "event": "lead.found", "name": "Sunshine Travel" } }',
      },
      {
        id: "send_sms",
        title: "send_sms",
        summary: "Send an SMS message.",
        whenToUse: "Urgent alerts or SMS outreach (when provider configured).",
        savesTo: "External SMS + chat log.",
        exampleInstruction: "Text the account owner if critical ticket is open > 1 hour.",
        exampleJson: '{ "type": "send_sms", "to": "+15551234567", "body": "Critical ticket open" }',
      },
      {
        id: "crm_sync",
        title: "crm_sync",
        summary: "Push contact data to HubSpot/Salesforce-style CRM.",
        whenToUse: "Sync leads to external CRM after create_entity locally.",
        savesTo: "External CRM + optional local entity link.",
        exampleInstruction: "After creating lead locally, crm_sync to HubSpot with email and company.",
        exampleJson:
          '{ "type": "crm_sync", "provider": "hubspot", "email": "info@co.com", "name": "Jane", "company": "Sunshine Travel" }',
      },
      {
        id: "http_request",
        title: "http_request",
        summary: "Server-side HTTP call (not browser fetch).",
        whenToUse: "REST APIs, internal microservices — host must be allowed in Policies.",
        savesTo: "Depends on API; response in chat summary.",
        exampleInstruction: "Call our internal API to register the lead after form submit.",
        exampleJson:
          '{ "type": "http_request", "method": "POST", "url": "https://api.example.com/leads", "body": "{}" }',
      },
      {
        id: "create_calendar_event",
        title: "create_calendar_event",
        summary: "Create a calendar event.",
        whenToUse: "Book demo calls after lead qualifies.",
        savesTo: "Calendar integration (when configured).",
        exampleInstruction: "Schedule demo next Tuesday 2pm with the prospect email.",
        exampleJson:
          '{ "type": "create_calendar_event", "title": "Vughy demo", "startAt": "2026-03-10T14:00:00Z", "attendee": "lead@co.com" }',
      },
      {
        id: "attach_document",
        title: "attach_document",
        summary: "Save a file to YamBot document storage linked to an entity.",
        whenToUse: "Store PDFs, screenshots, exports from browser workflows.",
        savesTo: "Document storage + entity link in MongoDB.",
        exampleInstruction: "Save exported CSV as attach_document linked to the campaign entity.",
        exampleJson:
          '{ "type": "attach_document", "filename": "report.csv", "dataBase64": "...", "entityId": "..." }',
      },
    ],
  },
  {
    id: "research",
    title: "Research",
    intro: "Deep multi-source investigation.",
    actions: [
      {
        id: "investigate",
        title: "investigate",
        summary: "Aggregate evidence from multiple sources with contradiction checks.",
        whenToUse: "Complex research goals — market analysis, compliance checks, due diligence.",
        savesTo: "Chat summary + structured evidence in action payload.",
        exampleInstruction: "Investigate competitor pricing across 3 sites and cite sources.",
        exampleJson:
          '{ "type": "investigate", "question": "Compare visa API pricing", "sources": ["https://…"] }',
      },
    ],
  },
];

/** Flat list of every action id for anchor links and search. */
export const ALL_AGENT_ACTION_IDS = AGENT_ACTION_SECTIONS.flatMap((s) =>
  s.actions.map((a) => a.id)
);
