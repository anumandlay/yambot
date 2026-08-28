/**
 * @fileoverview Central help text for tooltips and the How To guide.
 * Purpose: Single source of truth for detailed UI explanations across YamBot.
 * Downstream: HelpTooltip, FieldLabel, HowToPage.
 */

/**
 * @typedef {{ title: string, body: string, learnMore?: string }} HelpEntry
 */

/**
 * Builds a multi-paragraph help body from sections.
 * @param  {...string} parts
 * @returns {string}
 */
export function helpBody(...parts) {
  return parts.filter(Boolean).join("\n\n");
}

/** @type {Record<string, HelpEntry>} */
export const HELP = {
  // ─── Global / navigation ─────────────────────────────────────────────
  "nav.start": {
    title: "Get started",
    body: helpBody(
      "First-run checklist: connect your LLM, create one agent, open a chat, and send a goal.",
      "Complete these three steps once — after that, Chats is your home for day-to-day work."
    ),
    learnMore: "getting-started",
  },
  "nav.agentActions": {
    title: "Agent actions",
    body: helpBody(
      "Reference catalog of every command agents can run: navigate, create_entity, update_kpi, send_email, and more.",
      "Copy example instructions into Goals or chats — the LLM picks actions; YamBot saves to chat or database as documented."
    ),
  },
  "nav.agents": {
    title: "Agents",
    body: helpBody(
      "Agents are your AI employees — each one is a named browser worker with its own personality, skills, memory, and dedicated cloud Chromium computer on the VPS.",
      "Create an agent when you need a repeatable role (researcher, shopper, support rep). One agent = one persistent browser profile, one queue of tasks, and one live screen you can watch or take over.",
      "From here you open agent settings, start chats, or delete agents (which also removes their cloud container)."
    ),
    learnMore: "howto-agents",
  },
  "nav.goals": {
    title: "Goals",
    body: helpBody(
      "Goals are durable business objectives — not one-off chat messages. They store title, instructions, KPIs, priority, SLA, and optional autonomy (the agent checks KPIs on a schedule and spawns work itself).",
      "Use Goals when work should outlive a single chat: weekly reporting, monitoring a metric, ongoing outreach. Click Run on a goal to enqueue a task linked to that goal.",
      "Goals differ from Chats: chats are conversational threads; goals are the Employee OS layer that tracks outcomes over time."
    ),
    learnMore: "howto-goals",
  },
  "nav.live": {
    title: "Live Wall",
    body: helpBody(
      "Live Wall shows a grid of every agent's cloud browser screen in real time. Use it to supervise many workers at once without opening each chat.",
      "Screens refresh automatically. If an agent is stuck on a CAPTCHA or login, open its chat and use Take control on the live screen."
    ),
    learnMore: "howto-live",
  },
  "nav.chats": {
    title: "Chats",
    body: helpBody(
      "Chats are conversation threads tied to one agent. You type a goal in plain English; the agent's cloud worker claims the task, opens Chromium, and executes step by step.",
      "Each message can enqueue a new browser task. Progress appears as agent messages, live screen updates, and task events in the right rail."
    ),
    learnMore: "howto-chats",
  },
  "nav.workforce": {
    title: "Workforce",
    body: helpBody(
      "Workforce is Layer 3 management: manager agents delegate child goals to worker agents they manage.",
      "Set an agent's role to Manager on its edit page, pick managed agents, then use this page to delegate instructions under a parent goal."
    ),
    learnMore: "howto-workforce",
  },
  "nav.operations": {
    title: "Operations",
    body: helpBody(
      "Operations is the company nervous system: the event bus (things that happened), triggers (rules that react to events or time), and watchers (URL monitors that emit change events).",
      "External systems can POST to /api/events/webhook. Triggers can enqueue tasks or emit follow-up events when conditions match."
    ),
    learnMore: "howto-operations",
  },
  "nav.queues": {
    title: "Queues",
    body: helpBody(
      "Operational work queues: support tickets (auto-created from inbound email), campaign pipeline stages, pending agent tasks, and document attachments.",
      "Assign tickets to agents; agents use update_ticket and set_entity_status actions during runs."
    ),
  },
  "nav.deals": {
    title: "Deals",
    body: helpBody("Sales pipeline — prospect through won/lost with amounts linked to entities."),
  },
  "nav.invoices": {
    title: "Invoices",
    body: helpBody("Billing documents: draft, sent, paid. Agents can update_invoice during runs."),
  },
  "deals.page": {
    title: "Deals pipeline",
    body: helpBody("Kanban-style deal stages. Move deals as sales progresses."),
  },
  "queues.page": {
    title: "Queues page",
    body: helpBody(
      "Tickets tab: filter by status, assign agents, resolve/close. Campaign pipeline shows enrollment stages. Agent queue lists pending/running tasks. Documents: upload files to attach to entities."
    ),
  },
  "queues.tickets": {
    title: "Ticket queue",
    body: helpBody(
      "Inbound email creates tickets when not handled as campaign reply. Manual tickets supported too.",
      "Tickets are scoped by agent group (country): USA support agents only see USA tickets."
    ),
  },
  "queues.ticketTerritory": {
    title: "Ticket territory",
    body: helpBody(
      "Filter Queues tickets by agent group (e.g. USA). Same territory model as Company leads."
    ),
  },
  "queues.campaigns": { title: "Campaign pipeline", body: helpBody("Enrollment counts by stage across active campaigns.") },
  "queues.tasks": { title: "Agent queue", body: helpBody("All pending, running, and waiting_user tasks across agents.") },
  "queues.documents": { title: "Documents", body: helpBody("Upload up to 5 MB per file. Agents can attach_document during runs.") },
  "ops.triggerType": {
    title: "Trigger type",
    body: helpBody(
      "Event: fires on bus event type. Time: interval poll. Condition: metric baseline threshold. Threshold: goal KPI percent breach. Anomaly: high task failure rate in last hour."
    ),
  },
  "nav.company": {
    title: "Company",
    body: helpBody(
      "Company holds your world model: Entities (customers, leads, vendors with temporal observations), Company Memory (durable facts the OS injects into decisions), and Processes (defined workflows and instances).",
      "This is the digital twin of your business — agents and autonomy engines read from here when investigating or planning."
    ),
    learnMore: "howto-company",
  },
  "nav.skills": {
    title: "Skills",
    body: helpBody(
      "Skills are reusable playbooks from Teach skill, New skill / import, or /learn — not auto-created after runs. When an agent hits an unknown workflow it can file a Training Request; you teach a demo and convert it to a skill."
    ),
    learnMore: "howto-skills",
  },
  "nav.policies": {
    title: "Policies",
    body: helpBody(
      "Policies are organization-wide governance defaults (Layer 2): approval before submit/purchase, URL blocks, LLM budgets, HTTP tool allowlists, escalation timers.",
      "Per-agent policy overrides on the agent edit page merge with these defaults — the stricter or agent-specific value wins where applicable."
    ),
    learnMore: "howto-policies",
  },
  "nav.governance": {
    title: "Governance",
    body: helpBody(
      "Governance is Layer 5 oversight: audit log (who did what), pending approvals (submit/purchase gates), LLM spend vs budget, improvement proposals, and performance reviews.",
      "Use this when you need accountability, cost control, or to approve autonomous suggestions before they take effect."
    ),
    learnMore: "howto-governance",
  },
  "nav.system": {
    title: "System",
    body: helpBody(
      "System shows VPS health: API status, running cloud worker containers per agent, and controls to restart or inspect infrastructure.",
      "Use when an agent's computer failed to start or you need to confirm deploy/version after an update."
    ),
    learnMore: "howto-system",
  },
  "nav.settings": {
    title: "Settings",
    body: helpBody(
      "Settings stores your account secrets: LLM API credentials (required for agents to think), optional Vision LLM (screenshot error recovery), and DeathByCaptcha (automated CAPTCHA solving).",
      "Secrets are encrypted on the server and injected into cloud workers at task runtime — never embedded in the browser extension (cloud-only product)."
    ),
    learnMore: "howto-settings",
  },
  "nav.howto": {
    title: "How To guide",
    body: helpBody(
      "Open the full YamBot manual: step-by-step instructions for agents, goals, skills, chats, governance, and every major feature.",
      "Use question-mark icons (?) next to fields for context-specific deep dives.",
      "Turn Help & tooltips off anytime from the sidebar switch, mobile header, or Settings — your preference is saved to your account."
    ),
  },
  "help.toggle": {
    title: "Help & tooltips",
    body: helpBody(
      "When enabled, YamBot shows ? icons beside labels and buttons plus the How To manual in the sidebar.",
      "When disabled, all contextual help is hidden for a cleaner UI. You can re-enable this switch from Settings or the sidebar at any time."
    ),
  },

  // ─── Auth ────────────────────────────────────────────────────────────
  "auth.email": {
    title: "Email",
    body: helpBody(
      "Your login email. Must be unique in this YamBot instance. Used only for authentication — separate from agent SMTP mailboxes."
    ),
  },
  "auth.password": {
    title: "Password",
    body: helpBody(
      "Account password (hashed on server). Use a strong password; this protects all agents, chats, and API keys stored under your user."
    ),
  },
  "auth.name": {
    title: "Display name",
    body: helpBody(
      "Your human name for the account record. Not shown to agents; optional identification in multi-user setups."
    ),
  },
  "auth.login": {
    title: "Log in",
    body: helpBody(
      "Authenticates your session (JWT). After login you can create agents, chats, and goals. Session persists until logout or expiry."
    ),
  },
  "auth.register": {
    title: "Create account",
    body: helpBody(
      "Registers a new YamBot user on this server. You will need to add LLM API keys in Settings before agents can run tasks."
    ),
  },

  "admin.nav": {
    title: "Super admin",
    body: helpBody(
      "Platform operator console (SaaS). Lists every registered tenant user with agent counts, task volume, and estimated LLM spend.",
      "Only accounts with role superadmin or email in server SUPERADMIN_EMAILS can access this."
    ),
  },
  "admin.login": {
    title: "Super-admin sign in",
    body: helpBody(
      "Uses the same user database as regular login but only allows superadmin accounts into /admin/users.",
      "Configure SUPERADMIN_BOOTSTRAP_EMAIL on the server for first-time setup, or add emails to SUPERADMIN_EMAILS."
    ),
  },
  "admin.users.page": {
    title: "Platform admin console",
    body: helpBody(
      "Cross-tenant dashboard for YamBot as a SaaS product. See all sign-ups, their usage, and total platform LLM cost.",
      "Regular tenant users never see other accounts — this view is operator-only."
    ),
  },
  "admin.users.table": {
    title: "Users table",
    body: helpBody(
      "Each row is one tenant account. Wallet = prepaid USD balance. Agents = browser workers they created. Tasks = all queued/running/completed jobs. LLM USD = sum of estimated cost on completed tasks.",
      "Use Grant credits to add promotional balance without Stripe."
    ),
  },
  "admin.pricing.agentPrice": {
    title: "Price per new agent",
    body: helpBody(
      "Platform-wide fee in USD charged from the user's wallet when they create a new agent. Set to 0 for free agent creation.",
      "Existing agents are not re-charged on edit."
    ),
  },
  "admin.pricing.save": {
    title: "Save pricing",
    body: helpBody(
      "Applies immediately to all new agent creations on this YamBot instance."
    ),
  },
  "admin.grantCredits": {
    title: "Grant free credits",
    body: helpBody(
      "Add promotional or support credits to a user's wallet without Stripe. Creates an admin_credit ledger entry.",
      "Use for trials, refunds, or enterprise deals."
    ),
  },
  "admin.grantCredits.user": {
    title: "Select user",
    body: helpBody(
      "Tenant account to receive credits. Current wallet balance shown in dropdown."
    ),
  },
  "admin.grantCredits.amount": {
    title: "Credit amount",
    body: helpBody(
      "USD amount added to wallet instantly."
    ),
  },
  "admin.grantCredits.note": {
    title: "Credit note",
    body: helpBody(
      "Shown in user's transaction history (e.g. 'Launch promo', 'Support refund')."
    ),
  },
  "admin.grantCredits.submit": {
    title: "Grant credits",
    body: helpBody(
      "Credits the selected user's wallet and refreshes the table."
    ),
  },

  "nav.wallet": {
    title: "Wallet",
    body: helpBody(
      "Prepaid USD balance. Top up via Stripe; spent when creating agents (if platform price is set) and future usage billing.",
      "View balance and transaction history here."
    ),
    learnMore: "howto-wallet",
  },
  "wallet.page": {
    title: "Wallet page",
    body: helpBody(
      "Your prepaid account balance for YamBot SaaS. Stripe checkout adds funds; agent creation debits the configured per-agent price.",
      "Admin can also grant free credits from the super-admin console."
    ),
    learnMore: "howto-wallet",
  },
  "wallet.balance": {
    title: "Current balance",
    body: helpBody(
      "Available USD in your wallet. Must cover agent creation fee before POST /api/agents succeeds."
    ),
  },
  "wallet.agentPrice": {
    title: "Agent creation fee",
    body: helpBody(
      "Set by platform super-admin. One-time charge per new agent, not per edit or per task."
    ),
  },
  "wallet.topup": {
    title: "Stripe top-up",
    body: helpBody(
      "Redirects to Stripe Checkout. Funds appear after webhook confirms payment (usually seconds)."
    ),
  },
  "wallet.topupAmount": {
    title: "Preset top-up",
    body: helpBody(
      "Quick amounts — opens Stripe Checkout for that USD value."
    ),
  },
  "wallet.customAmount": {
    title: "Custom top-up amount",
    body: helpBody(
      "Minimum $1, maximum $5,000 per transaction."
    ),
  },
  "wallet.checkout": {
    title: "Pay with Stripe",
    body: helpBody(
      "Secure payment via Stripe. You return to this page after success or cancel."
    ),
  },
  "wallet.transactions": {
    title: "Transaction history",
    body: helpBody(
      "Ledger: stripe_topup (credit), admin_credit (credit), agent_create (debit), refund (credit)."
    ),
  },

  // ─── Agents list ─────────────────────────────────────────────────────
  "agents.page": {
    title: "Agents page",
    body: helpBody(
      "Lists all browser agents you own. Each row shows name, skill summary, and actions: Chat (new thread), Edit (full config), Delete (stops cloud container).",
      "New agent provisions a fresh Docker Chromium worker bound to that agent ID on the VPS."
    ),
    learnMore: "howto-agents",
  },
  "agents.new": {
    title: "New agent",
    body: helpBody(
      "Opens the agent editor to define name, persona, instructions, autonomy, schedule, email, and policies. Saving creates the agent record and starts its cloud computer container.",
      "Minimum: a name. Strongly recommended: Skill, Profile, and Standing instructions so the LLM knows how to behave."
    ),
    learnMore: "howto-create-agent",
  },
  "agents.chat": {
    title: "Start chat",
    body: helpBody(
      "Creates a new chat thread bound to this agent. You'll land in the chat view where you can type goals; each goal becomes a queued browser task for this agent's cloud worker."
    ),
  },
  "agents.edit": {
    title: "Edit agent",
    body: helpBody(
      "Opens full agent configuration: persona, scheduler, email identity, facts, memory, site profiles, workforce role, and per-agent policy overrides."
    ),
  },
  "agents.delete": {
    title: "Delete agent",
    body: helpBody(
      "Permanently removes the agent, its cloud Chromium container, and associated data you don't need elsewhere. Chats may remain but lose the agent link. Confirm carefully."
    ),
  },
  "agents.copy": {
    title: "Copy agent",
    body: helpBody(
      "Duplicates this agent's configuration (instructions, facts, email, schedule, policies) into a new agent named “{name} copy YYYY-MM-DD HH:mm”.",
      "A new cloud computer is provisioned. Edit the name after copying."
    ),
  },
  "agents.groupFilter": {
    title: "Filter by group",
    body: helpBody(
      "Show all agents, only ungrouped ones, or a single group folder. Groups are separate for agents vs goals."
    ),
  },
  "agents.newGroup": {
    title: "New agent group",
    body: helpBody(
      "Create a folder label (e.g. CRM team). Assign agents via the Group dropdown on each row or on the agent edit page."
    ),
  },
  "agents.groupAssign": {
    title: "Assign group",
    body: helpBody("Move this agent into a group folder for easier browsing on the Agents list."),
  },

  // ─── Agent edit ──────────────────────────────────────────────────────
  "agent.name": {
    title: "Agent name",
    body: helpBody(
      "Short unique label shown in lists, Live Wall, and chats (e.g. 'Pricing Analyst', 'Support Bot').",
      "The cloud container is labeled with this agent's ID internally; name is for humans only."
    ),
  },
  "agent.jobBrief": {
    title: "Job brief (plain English)",
    body: helpBody(
      "Describe what this agent should do in everyday language. Generate with AI fills skill, persona, standing instructions (including entities when relevant), and success criteria.",
      "You still pick the Group (country) yourself — the draft does not set territory.",
      "Review and edit the generated fields before saving."
    ),
  },
  "agent.group": {
    title: "Agent group",
    body: helpBody(
      "Optional folder on the Agents list (e.g. USA). Create groups from the Agents page filter bar.",
      "Also the territory for Company leads and tickets: agents in the same group share that database. Upload leads on this page into the selected group."
    ),
  },
  "agent.leadsUpload": {
    title: "Upload leads",
    body: helpBody(
      "Paste or choose a CSV of leads. They are saved into the Group selected above (not a private per-agent file).",
      "Formats: email,name,company or name,type,email. New leads get status \"new\". Any agent in that group can search_entities them.",
      "Pick a group first (e.g. USA). You can upload before or after saving the agent."
    ),
  },
  "agent.description": {
    title: "Short description",
    body: helpBody(
      "One-line summary for the agents list. Optional but helps you distinguish similar agents at a glance."
    ),
  },
  "agent.skill": {
    title: "Skill (capability text)",
    body: helpBody(
      "Free-text description of what this agent is good at — injected into every LLM prompt. Example: 'Compare competitor pricing on public sites and summarize with URLs.'",
      "Not the same as Skills page playbooks: this field shapes reasoning style; structured Skills are separate reusable workflows."
    ),
    learnMore: "howto-skills",
  },
  "agent.profile": {
    title: "Profile / persona",
    body: helpBody(
      "Who the agent 'is': tone, role, constraints ('You are a careful paralegal assistant…'). Combined with Skill and Instructions to form the system persona.",
      "Use for voice (formal/casual), domain expertise, and boundaries ('never purchase without approval')."
    ),
  },
  "agent.instructions": {
    title: "Standing instructions",
    body: helpBody(
      "Persistent rules applied on every task run: cite sources, prefer official sites, always screenshot checkout, ask before login, etc.",
      "These override casual chat tone — treat as mandatory operating procedures.",
      "Use the “Entities & how to use” link next to this field for lead/CRM instruction examples."
    ),
  },
  "agent.entitiesGuide": {
    title: "Entities — your agent’s database",
    body: helpBody(
      "Entities are Company CRM records in the agent's group territory (e.g. USA). Agents in the same group share that database.",
      "type (fixed): lead | customer | vendor | product | process | document | ticket | custom.",
      "kind (yours): segment or table inside a type — e.g. lead+kind airlines, custom+kind weather.",
      "lead = prospect (status new → contacted → converted). customer = won. vendor = supplier. product = what you sell. custom = invented data (always set kind). Prefer Queues → Tickets for support email.",
      "Lead finder:\ncreate_entity type lead, kind \"travel_agency_leads\", status \"new\", attributes email, phone, website.",
      "Weather writer:\ncreate_entity type custom, kind \"weather\", name \"NYC 2026-08-28\", attributes { city, tempC, humidity, date }.",
      "Weather reader:\nsearch_entities type custom, kind \"weather\".",
      "Tip: same kind spelling everywhere (normalized to lowercase snake_case)."
    ),
    learnMore: "howto-company",
  },
  "agent.successCriteria": {
    title: "Success criteria",
    body: helpBody(
      "Defines when a task should finish successfully: 'Return top 5 links with titles', 'Confirm order number visible', 'Email summary to user'.",
      "The LLM sees this when deciding to call finish; task evaluation may score runs against goal success criteria too."
    ),
  },
  "agent.cloudComputer": {
    title: "Cloud computer",
    body: helpBody(
      "Each agent gets a dedicated Playwright Chromium container on the VPS with a persistent profile (cookies, local storage).",
      "Take control in chat streams your mouse/keyboard to that browser. One agent = one box — tasks for the same agent never run in parallel on different machines."
    ),
  },
  "agent.schedule.enabled": {
    title: "Scheduled runs",
    body: helpBody(
      "When enabled, the server enqueues the Scheduled goal text on the chosen interval without you opening chat.",
      "Creates/uses a chat titled 'Schedule · {agent name}'. Skips a tick if a task is already pending or running for this agent."
    ),
  },
  "agent.schedule.goal": {
    title: "Scheduled goal",
    body: helpBody(
      "Plain-English task text enqueued automatically — same as typing in chat. Example: 'Check competitor homepage for pricing changes and summarize.'"
    ),
  },
  "agent.schedule.interval": {
    title: "Schedule frequency",
    body: helpBody(
      "How often to enqueue the scheduled goal: 15m–24h or once daily at a UTC time. Server scheduler checks every minute; actual run may drift slightly under load."
    ),
  },
  "agent.schedule.dailyAt": {
    title: "Daily time (UTC)",
    body: helpBody(
      "For 'daily' interval only: hour:minute in UTC when the scheduled goal fires. Convert from your local timezone when planning."
    ),
  },
  "agent.email.enabled": {
    title: "Agent email",
    body: helpBody(
      "Gives this agent its own SMTP/IMAP identity so it can send_email and check_email actions — verification codes, outreach, human-like mail without Gmail web UI.",
      "Credentials encrypted at rest. Prefer app passwords for Gmail/Outlook."
    ),
  },
  "agent.email.fromName": {
    title: "From name",
    body: helpBody(
      "Display name recipients see (e.g. 'Alex from Acme'). Shown in send_email and test messages."
    ),
  },
  "agent.email.fromAddress": {
    title: "From address",
    body: helpBody(
      "SMTP From email address. Must be authorized on your mail provider. Test email sends to this address."
    ),
  },
  "agent.email.smtpHost": {
    title: "SMTP host",
    body: helpBody(
      "Outgoing mail server hostname (smtp.gmail.com, smtp.sendgrid.net, etc.). Required for send_email."
    ),
  },
  "agent.email.smtpPort": {
    title: "SMTP port",
    body: helpBody(
      "Usually 587 (STARTTLS) or 465 (SSL). Match your provider docs; enable 'SMTP TLS on connect' for 465."
    ),
  },
  "agent.email.smtpUser": {
    title: "SMTP username",
    body: helpBody(
      "Often the same as From address. Some providers use 'apikey' for API-based SMTP."
    ),
  },
  "agent.email.smtpPassword": {
    title: "SMTP password",
    body: helpBody(
      "App password or SMTP secret. Leave blank on save to keep existing encrypted password. Never share in chat messages."
    ),
  },
  "agent.email.imapHost": {
    title: "IMAP host",
    body: helpBody(
      "Incoming mail server for check_email (imap.gmail.com). If blank, worker may derive from SMTP host."
    ),
  },
  "agent.email.imapPort": {
    title: "IMAP port",
    body: helpBody(
      "Typically 993 (SSL). Used when agent reads inbox for codes or replies."
    ),
  },
  "agent.email.smtpSecure": {
    title: "SMTP TLS on connect",
    body: helpBody(
      "Enable for port 465 (implicit TLS). Leave off for 587 with STARTTLS."
    ),
  },
  "agent.email.test": {
    title: "Save & send test email",
    body: helpBody(
      "Saves this agent's email settings first, then sends a test to the From address.",
      "Requires Enable checked, SMTP host/user/password, and From address. On /agents/new, create the agent once before testing."
    ),
  },
  "agent.startUrl": {
    title: "Start URL",
    body: helpBody(
      "Fallback homepage when a goal does not name a site. If the goal says “open vughy.com”, that site wins — this field is ignored.",
      "Leave empty for about:blank when the goal has no URL."
    ),
  },
  "agent.allowedDomains": {
    title: "Allowed domains",
    body: helpBody(
      "Comma-separated hostnames the agent may visit. Empty = any non-blocked URL (still subject to Policies blocked patterns).",
      "Extra safety for specialized agents that should never leave approved sites."
    ),
  },
  "agent.facts": {
    title: "Facts",
    body: helpBody(
      "Key-value pairs injected into prompts (product_url, account_id, support_phone). Use for stable reference data the agent must not invent.",
      "Example: competitor_urls → https://a.com, https://b.com"
    ),
  },
  "agent.facts.add": {
    title: "Add fact",
    body: helpBody(
      "Adds another key-value row. Empty keys are ignored on save."
    ),
  },
  "agent.role": {
    title: "Workforce role",
    body: helpBody(
      "Worker: executes browser tasks only. Manager: can own managed agents and delegate child goals from Workforce page (and manager autonomy may react to events).",
      "Managers do not replace human oversight — they organize work across workers."
    ),
    learnMore: "howto-workforce",
  },
  "agent.managedAgents": {
    title: "Managed agents",
    body: helpBody(
      "When role is Manager, select worker agents this manager may delegate to. Delegation creates child goals assigned to those workers."
    ),
  },
  "agent.policy.requireApproval": {
    title: "Require approval before submit",
    body: helpBody(
      "Per-agent override: submit/purchase clicks pause until approved in Governance → Pending approvals. Merges with org Policies setting."
    ),
  },
  "agent.policy.monthlyBudget": {
    title: "Agent monthly LLM budget",
    body: helpBody(
      "USD cap on estimated LLM spend for this agent per calendar month. 0 = inherit org default / unlimited. Worker stops claiming tasks when exceeded."
    ),
  },
  "agent.policy.dailyBudget": {
    title: "Agent daily LLM budget",
    body: helpBody(
      "USD cap per UTC day for this agent. Prevents runaway costs from a single bad loop. 0 = no daily cap."
    ),
  },
  "agent.policy.maxTaskMinutes": {
    title: "Max task duration",
    body: helpBody(
      "Hard stop: worker aborts task after this many minutes and marks error time_budget_exceeded. 0 = use org policy or unlimited.",
      "Protects against infinite browse loops."
    ),
  },
  "agent.autonomy.allowSubmit": {
    title: "Allow submit / apply clicks",
    body: helpBody(
      "If off, agent skips submit-like clicks (forms, purchases). Use with Policies approval for high-risk flows."
    ),
  },
  "agent.autonomy.allowCaptcha": {
    title: "Allow CAPTCHA solving",
    body: helpBody(
      "If on, agent may call solve_captcha (DeathByCaptcha). Image CAPTCHAs on Amazon etc. still often need human Take control."
    ),
  },
  "agent.autonomy.askBeforeLogin": {
    title: "Ask before login walls",
    body: helpBody(
      "Agent uses ask_user before entering credentials on login pages — you type secrets in chat or take control."
    ),
  },
  "agent.autonomy.askBeforeSubmit": {
    title: "Ask before submit clicks",
    body: helpBody(
      "Lighter than full Governance approval: agent asks in chat ('Reply yes to continue') before submit-like clicks."
    ),
  },
  "agent.autonomy.visionEnabled": {
    title: "Vision screenshots",
    body: helpBody(
      "When enabled, cloud worker may attach viewport screenshots to LLM on verification failures (uses Vision LLM from Settings).",
      "Costs more tokens but recovers from stale refs and hidden UI."
    ),
  },
  "agent.active": {
    title: "Agent active",
    body: helpBody(
      "Inactive agents may be skipped by schedulers and shown as paused. Cloud container may still exist until deleted."
    ),
  },
  "agent.save": {
    title: "Save agent",
    body: helpBody(
      "Writes configuration to MongoDB and syncs cloud worker container (create/restart as needed). Changes apply to the next task run."
    ),
  },
  "agent.delete": {
    title: "Delete this agent",
    body: helpBody(
      "Removes agent and stops/removes its cloud container. Irreversible."
    ),
  },
  "agent.memory": {
    title: "Agent memory notes",
    body: helpBody(
      "Long-term notes the agent (or you) append across runs — surfaced in future prompts. Use for lessons learned, site quirks, customer context."
    ),
  },
  "agent.liveScreen": {
    title: "Live cloud screen",
    body: helpBody(
      "Embedded stream of this agent's Chromium viewport. From chat you can Take control; here you only watch."
    ),
  },
  "agent.siteProfiles": {
    title: "Site profiles",
    body: helpBody(
      "Per-domain learning: visit counts, success/failure stats, and hints the agent discovered (selectors, flows). Editable or deletable.",
      "Built automatically as the agent works sites; speeds up return visits."
    ),
  },
  "agent.siteProfile.domain": {
    title: "Site domain",
    body: helpBody(
      "Hostname only (example.com) — hints you add apply to that domain on future tasks for this agent."
    ),
  },
  "agent.siteProfile.hintKind": {
    title: "Hint kind",
    body: helpBody(
      "note: general tip. flow: step sequence. avoid: do not click paths. selector: stable CSS/xpath guidance for controls."
    ),
  },
  "agent.siteProfile.hintText": {
    title: "Hint content",
    body: helpBody(
      "Free-text injected into SITE MEMORY on tasks for this domain. Be specific ('Checkout button is #buy-now')."
    ),
  },
  "agent.siteProfile.add": {
    title: "Add site hint",
    body: helpBody(
      "Creates or updates SiteProfile for domain and appends hint. Worker learn layer reads these on next visit."
    ),
  },

  // ─── Goals ───────────────────────────────────────────────────────────
  "goals.page": {
    title: "Goals page",
    body: helpBody(
      "Lists durable objectives (Employee OS Layer 1). Each goal can have KPIs, priority, assigned agent, parent goal for delegation, autonomy, and SLA.",
      "Run enqueues a browser task using the goal's instructions. Stats track runs and outcomes over time.",
      "When autonomy is on and status is active, a live countdown shows time until the next autonomy check may enqueue a run."
    ),
    learnMore: "howto-goals",
  },
  "goals.new": {
    title: "New goal",
    body: helpBody(
      "Create a persistent objective. Fill instructions as you would tell an employee. Assign an agent responsible for execution."
    ),
  },
  "goals.run": {
    title: "Run goal",
    body: helpBody(
      "Enqueues one browser task now: builds goal text from title + instructions + success criteria, links task.goalRef, applies priority rank.",
      "Does not replace autonomy — scheduled self-checks are separate."
    ),
  },
  "goals.delete": {
    title: "Delete goal",
    body: helpBody(
      "Permanently removes this goal definition and its run stats.",
      "Tasks already started from this goal stay in chat history."
    ),
  },
  "goals.copy": {
    title: "Copy goal",
    body: helpBody(
      "Duplicates instructions, KPIs, completion actions, and events into a new goal titled “{title} copy YYYY-MM-DD HH:mm”. Run stats reset to zero."
    ),
  },
  "goals.groupFilter": {
    title: "Filter by group",
    body: helpBody("Show all goals, ungrouped only, or one group folder."),
  },
  "goals.newGroup": {
    title: "New goal group",
    body: helpBody("Create a folder (e.g. Vughy workflows) and assign goals from the list or edit page."),
  },
  "goals.groupAssign": {
    title: "Assign group",
    body: helpBody("Move this goal into a group folder on the Goals list."),
  },
  "goal.title": {
    title: "Goal title",
    body: helpBody(
      "Short name for dashboards and delegation ('Weekly competitor scan', 'Monitor support queue')."
    ),
  },
  "goal.jobBrief": {
    title: "Job brief (plain English)",
    body: helpBody(
      "Describe what this goal should accomplish. Generate with AI fills title, description, run instructions, and success criteria.",
      "You still pick the Assigned agent yourself — the draft does not choose who runs it.",
      "Review and edit before saving. Differ from agent brief: this drafts the job (goal), not the employee persona."
    ),
  },
  "goal.group": {
    title: "Goal group",
    body: helpBody(
      "Optional folder on the Goals list. Create groups from the Goals page filter bar."
    ),
  },
  "goal.agent": {
    title: "Assigned agent",
    body: helpBody(
      "Which agent's cloud worker executes Run and autonomy-spawned tasks. Required for execution."
    ),
  },
  "goal.parent": {
    title: "Parent goal",
    body: helpBody(
      "Links this goal as a child in a hierarchy — used with Workforce delegation and reporting rollups."
    ),
  },
  "goal.status": {
    title: "Goal status",
    body: helpBody(
      "active: normal. paused: skip autonomy checks. completed/archived: historical, no new auto-runs."
    ),
  },
  "goal.priority": {
    title: "Goal priority",
    body: helpBody(
      "Maps to task priorityRank when enqueued: urgent > high > normal > low. Affects claim order when multiple tasks pending."
    ),
  },
  "goal.description": {
    title: "Goal description",
    body: helpBody(
      "Human-readable context not always sent to worker — use Instructions for executable text. Good for your team's notes."
    ),
  },
  "goal.instructions": {
    title: "Instructions",
    body: helpBody(
      "Primary executable brief sent to the cloud worker on Run — step-by-step what to do in the browser.",
      "Be specific: URLs, data sources, output format, stop conditions."
    ),
  },
  "goal.successCriteria": {
    title: "Success criteria",
    body: helpBody(
      "Measurable done-state for evaluation and autonomy ('KPI current updated', 'PDF downloaded', '3 sources cited')."
    ),
  },
  "goal.completionEventType": {
    title: "Completion event type (success)",
    body: helpBody(
      "Optional dot-separated event type emitted on the Operations bus when a Run finishes successfully (e.g. crm.aanya.found).",
      "Triggers can listen for this type and automatically enqueue a follow-up browser task. task.completed still fires too."
    ),
    learnMore: "howto-operations",
  },
  "goal.completionEventOnFailure": {
    title: "Completion event type (failure)",
    body: helpBody(
      "Optional event type when the run fails (agent finish success:false). Leave blank to emit nothing on failure."
    ),
  },
  "goal.outcomeRouting": {
    title: "LLM outcome routing",
    body: helpBody(
      "After a run finishes, your LLM reads the agent's reply and picks one outcome branch to emit on the Operations bus.",
      "Works alongside success/failure completion events — e.g. temperature below 50°F → weather.cold, else weather.warm."
    ),
    learnMore: "howto-operations",
  },
  "goal.outcomeBranch": {
    title: "Outcome branch",
    body: helpBody(
      "Label + event type + plain-English 'when' condition. The LLM must pick one eventType from this list based on the task result."
    ),
  },
  "goal.completionActions": {
    title: "Completion actions",
    body: helpBody(
      "After a run finishes, spawn parallel follow-up tasks — instructions or other goals — with parent result injected via {{result}}.",
      "Use Rules for keyword/regex matching, or LLM to pick which actions run from the result text."
    ),
    learnMore: "howto-operations",
  },
  "goal.completionAction": {
    title: "Completion action",
    body: helpBody(
      "Unique label, run-on success/failure, optional when condition, agent override, and either free-text instructions or a goal to delegate."
    ),
  },
  "goal.kpi.name": {
    title: "KPI name",
    body: helpBody(
      "Metric label tracked on the goal (leads_contacted, tickets_closed, error_rate)."
    ),
  },
  "goal.kpi.target": {
    title: "KPI target",
    body: helpBody(
      "Numeric target value. Autonomy engine compares current vs target when enabled."
    ),
  },
  "goal.kpi.current": {
    title: "KPI current",
    body: helpBody(
      "Latest measured value — update manually or via future integrations. Autonomy may spawn tasks when below target."
    ),
  },
  "goal.kpi.unit": {
    title: "KPI unit",
    body: helpBody(
      "Display unit: %, USD, count, hours — for human readability only."
    ),
  },
  "goal.kpi.add": {
    title: "Add KPI",
    body: helpBody(
      "Another KPI row. Up to 20 per goal."
    ),
  },
  "goal.autonomy.enabled": {
    title: "Goal autonomy",
    body: helpBody(
      "When on, scheduler periodically evaluates KPIs and goal health; may enqueue tasks or emit events without you clicking Run.",
      "autoRun (default on) allows spawning tasks; interval minimum 1 minute."
    ),
    learnMore: "howto-autonomy",
  },
  "goal.autonomy.interval": {
    title: "Autonomy check interval",
    body: helpBody(
      "Minutes between autonomous self-assessments for this goal. Lower = more proactive, higher LLM cost."
    ),
  },
  "goal.sla.name": {
    title: "SLA name",
    body: helpBody(
      "Label for this response SLA ('First response', 'Resolution'). Shown in ops reporting."
    ),
  },
  "goal.sla.responseMinutes": {
    title: "SLA response target",
    body: helpBody(
      "Minutes within which linked tasks should start or complete. Breaches may emit events and raise priority. 0 = disabled."
    ),
  },
  "goal.save": {
    title: "Save goal",
    body: helpBody(
      "Persists goal document. Does not automatically run — use Run on Goals list or enable autonomy."
    ),
  },

  // ─── Chats ───────────────────────────────────────────────────────────
  "chats.page": {
    title: "Chats page",
    body: helpBody(
      "Two kinds of threads: **Common chat** — one inbox, pick an agent per goal. **Agent chats** — dedicated thread bound to one worker.",
      "Each agent still has its own cloud Chromium box and global FIFO queue per agent.",
      "Threads with a live browser job show badges: Live (running), Needs you (waiting), or Queued."
    ),
    learnMore: "howto-chats",
  },
  "chats.commonChat": {
    title: "Common chat",
    body: helpBody(
      "Neutral inbox — not tied to one agent. Each message you send picks which agent runs that goal.",
      "Use this as an orchestrator desk when you dispatch different workers from the same conversation."
    ),
  },
  "chats.agentSelect": {
    title: "Select agent",
    body: helpBody(
      "Which agent owns the new chat. All tasks in this thread run on that agent's cloud computer with its persona and policies."
    ),
  },
  "chats.newChat": {
    title: "New agent chat",
    body: helpBody(
      "Creates empty thread bound to one agent. All goals in this thread run on that agent's cloud computer."
    ),
  },
  "chats.newAgentLink": {
    title: "New agent (from chats)",
    body: helpBody(
      "Shortcut to agent editor if you have no agents yet."
    ),
  },
  "chats.delete": {
    title: "Delete chat",
    body: helpBody(
      "Removes this thread, its messages, and queued goals. Work running from this thread is stopped.",
      "Other chats with the same agent are not affected."
    ),
  },
  "chat.agentPicker": {
    title: "Dispatch agent",
    body: helpBody(
      "Which agent runs this goal. Type @AgentName at the start of your message to route automatically, or use this dropdown.",
      "Resolution order: @mention → picker → pinned default → last used agent."
    ),
  },
  "chat.pinDefault": {
    title: "Pin default agent",
    body: helpBody(
      "Saves the selected agent as this common chat's default when auto-route is off.",
      "With auto-route on, the router picks the agent unless you @mention or override."
    ),
  },
  "chat.autoRoute": {
    title: "Auto-route",
    body: helpBody(
      "When enabled, YamBot picks the best agent from your goal using skill matches and your LLM (Settings).",
      "Low-confidence picks ask you to confirm before dispatching."
    ),
  },
  "chat.mention": {
    title: "@mention routing",
    body: helpBody(
      "Start a goal with @AgentName — for example @CRM Bot check Aanya. The @prefix is stripped from the task goal but kept in the chat history.",
      "Multi-word names work: @CRM Bot goal here. Single-token shortcuts match the first unique agent (e.g. @crm → CRM Bot)."
    ),
  },
  "chat.skillSlash": {
    title: "Slash skill invoke",
    body: helpBody(
      "Start a goal with /skill-slug to load a production skill explicitly — e.g. /crm-followup check Aanya.",
      "Works with @mentions: @CRM Bot /crm-followup open follow-up tab."
    ),
  },
  "chat.skillPick": {
    title: "Skill selection",
    body: helpBody(
      "Shows which skill the worker loaded for a run and why: slash invoke (/slug), trigger pattern match, built-in template, or none.",
      "Appears when you send a goal (slash hint on your message) and again when the cloud worker starts (confirmed pick from goal + URL)."
    ),
  },
  "chat.learn": {
    title: "/learn command",
    body: helpBody(
      "Send /learn in chat to draft a SKILL.md playbook from the latest completed task trajectory in this thread.",
      "Optional name: /learn CRM follow-up. Edit triggers on Skills → promote to production."
    ),
  },
  "chat.goalInput": {
    title: "Goal message",
    body: helpBody(
      "Type what you want the browser agent to do in plain English. Sending enqueues a Task (status pending → running on cloud worker).",
      "Examples: 'Go to example.com and find pricing', 'Fill the contact form with …' Be explicit about constraints."
    ),
  },
  "chat.send": {
    title: "Send goal",
    body: helpBody(
      "Posts your message and enqueues a browser task at the back of this agent's queue (or runs next if queue empty)."
    ),
  },
  "chat.stop": {
    title: "Stop agent",
    body: helpBody(
      "Cancels the currently running task for this chat's agent. Pending queued goals remain — stop only the active run."
    ),
  },
  "chat.answer": {
    title: "Answer agent question",
    body: helpBody(
      "When task status is waiting_user, the agent used ask_user (CAPTCHA, confirmation, missing info). Your reply unblocks the run."
    ),
  },
  "chat.takeControl": {
    title: "Take control",
    body: helpBody(
      "Streams your mouse/keyboard to the agent's cloud Chromium — solve CAPTCHAs, manual login, or unblock the run.",
      "Does not record a skill demonstration. Use Teach skill when you want to capture a workflow for Skills."
    ),
  },
  "chat.teachSkill": {
    title: "Teach skill",
    body: helpBody(
      "Pauses the agent and records your clicks, typing, and navigation as a Demonstration.",
      "Perform the workflow once, click Done teaching, then convert the demo to a skill on the Skills page."
    ),
  },
  "chat.zoomChat": {
    title: "Chat in zoom",
    body: helpBody(
      "Floating chat feed while the live screen is full-screen — see agent messages, skill picks, and your goals without leaving zoom.",
      "Collapse with − to get more screen space; it keeps polling the thread."
    ),
  },
  "chat.taskQueue": {
    title: "Task queue",
    body: helpBody(
      "Agent chat: pending/active tasks for the bound agent (may include goals from other chats). Common chat: tasks grouped by dispatched agent.",
      "When multiple agents run from this common chat, use Watch agent to switch the live screen."
    ),
  },
  "chat.liveScreen": {
    title: "Live screen (chat)",
    body: helpBody(
      "Real-time view of what the cloud browser shows. Updates during task execution."
    ),
  },
  "chat.snapshot": {
    title: "Page snapshot",
    body: helpBody(
      "Accessibility tree snapshot the LLM sees: refs (e12), roles, names. Useful for debugging why agent clicked wrong control."
    ),
  },
  "chat.trajectory": {
    title: "Trajectory",
    body: helpBody(
      "Step-by-step actions the agent took this run. For debugging only — it does not create skills or suggested workflows.",
      "Create skills manually on the Skills page (New skill / Generate with AI) when you want a reusable playbook."
    ),
  },
  "chat.trajectorySave": {
    title: "Save trajectory as skill",
    body: helpBody(
      "Removed — runs no longer create suggested workflows. Use Skills → New skill or Generate with AI instead."
    ),
  },

  // ─── Settings ────────────────────────────────────────────────────────
  "settings.llmApiKey": {
    title: "LLM API key",
    body: helpBody(
      "Secret key for your LLM provider (MiniMax, OpenAI-compatible, etc.).",
      "Stored encrypted. Cloud workers fetch decrypted value per task via runtime-config."
    ),
  },
  "settings.llmBaseUrl": {
    title: "LLM base URL",
    body: helpBody(
      "API root URL (e.g. https://api.minimax.io/v1). Must match your provider's OpenAI-compatible endpoint."
    ),
  },
  "settings.llmModel": {
    title: "LLM model",
    body: helpBody(
      "Model id sent in chat completions (MiniMax-M2.7, gpt-4o, etc.). Affects quality, speed, and cost."
    ),
  },
  "settings.visionApiKey": {
    title: "Vision API key",
    body: helpBody(
      "Optional separate key for multimodal/vision models. Blank = use main LLM key for screenshot analysis."
    ),
  },
  "settings.visionBaseUrl": {
    title: "Vision base URL",
    body: helpBody(
      "Optional vision endpoint. Blank = main LLM base URL."
    ),
  },
  "settings.visionModel": {
    title: "Vision model",
    body: helpBody(
      "Model for image inputs (e.g. gpt-4o-mini). Blank = main LLM model. Used when agent.autonomy.visionEnabled and error recovery attaches screenshots."
    ),
  },
  "settings.testLlm": {
    title: "Test LLM connection",
    body: helpBody(
      "Sends a tiny chat completion to your provider using the API key, base URL, and model in this form (or saved secrets if fields are blank).",
      "Use this before running goals to confirm credentials work. Does not start an agent task."
    ),
  },
  "settings.openAiOAuthConnect": {
    title: "Connect OpenAI",
    body: helpBody(
      "Opens ChatGPT sign-in in a popup. Your subscription tokens are stored encrypted and used by cloud workers.",
      "You may need to paste the localhost redirect URL after sign-in. Disconnect to return to API key mode."
    ),
  },
  "settings.openAiOAuthPaste": {
    title: "Paste OAuth callback",
    body: helpBody(
      "Copy the full URL from the sign-in popup after login (http://localhost:1455/auth/callback?...).",
      "Required on web because the browser cannot receive the loopback redirect automatically."
    ),
  },
  "settings.dbcUsername": {
    title: "DeathByCaptcha username",
    body: helpBody(
      "Account for automated CAPTCHA solving service. Paired with DBC password."
    ),
  },
  "settings.dbcPassword": {
    title: "DeathByCaptcha password",
    body: helpBody(
      "DBC account password, encrypted at rest. Required for solve_captcha on supported puzzle types."
    ),
  },
  "settings.testDbc": {
    title: "Test DeathByCaptcha",
    body: helpBody(
      "Verifies DBC credentials with provider. Does not solve a live site CAPTCHA."
    ),
  },
  "settings.confirmBeforeSubmit": {
    title: "Confirm before submit (global)",
    body: helpBody(
      "Org default: agent asks in chat before submit-like clicks. Per-agent and Policies can add stricter Governance approval."
    ),
  },
  "settings.save": {
    title: "Save settings",
    body: helpBody(
      "Persists credentials. Running workers pick up changes on next task claim."
    ),
  },

  // ─── Policies ────────────────────────────────────────────────────────
  "policies.requireApproval": {
    title: "Require Governance approval",
    body: helpBody(
      "Submit/purchase/application clicks create Pending approval items. Worker polls until you Approve/Deny in Governance.",
      "Strongest gate for financial or legal actions."
    ),
  },
  "policies.confirmBeforeSubmit": {
    title: "Ask in chat before submit",
    body: helpBody(
      "Softer gate: agent ask_user before submit. Good for teams without formal approval workflow."
    ),
  },
  "policies.monthlyBudget": {
    title: "Monthly LLM budget",
    body: helpBody(
      "Org-wide USD cap per calendar month (sum of task llmUsage.estimatedUsd). 0 = unlimited. Workers see budget.exceeded in runtime-config."
    ),
  },
  "policies.dailyBudget": {
    title: "Daily LLM budget",
    body: helpBody(
      "Org-wide USD cap per UTC day. Stops runaway spend from bugs or loops."
    ),
  },
  "policies.maxTaskMinutes": {
    title: "Max task duration (org)",
    body: helpBody(
      "Default maximum minutes per task for all agents unless overridden per agent. Worker aborts with time_budget_exceeded."
    ),
  },
  "policies.escalateWaiting": {
    title: "Escalate waiting_user",
    body: helpBody(
      "After N minutes stuck waiting for your chat answer, scheduler may bump priority or emit escalation events."
    ),
  },
  "policies.blockedUrls": {
    title: "Blocked URL patterns",
    body: helpBody(
      "One pattern per line — substring or regex. navigate and http_request blocked if URL matches. Merged with per-agent blocks."
    ),
  },
  "policies.httpAllowHosts": {
    title: "HTTP tool allowed hosts",
    body: helpBody(
      "Hosts permitted for http_request action (api.example.com). Empty = any non-blocked host. One per line."
    ),
  },
  "policies.save": {
    title: "Save policies",
    body: helpBody(
      "Writes user-level defaults. Audit log records policy.updated."
    ),
  },

  // ─── Governance ──────────────────────────────────────────────────────
  "governance.budget": {
    title: "Monthly LLM budget (dashboard)",
    body: helpBody(
      "Live spend vs cap from completed tasks this month. exceeded flag when at or over cap."
    ),
  },
  "governance.approvals": {
    title: "Pending approvals",
    body: helpBody(
      "Submit/purchase clicks waiting for human decision. Approve lets worker continue; Deny skips action."
    ),
  },
  "governance.improvements": {
    title: "Improvement proposals",
    body: helpBody(
      "Autonomous suggestions from improvement loop after failures or anomalies. Approve to accept; Reject to dismiss.",
      "Does not auto-change production without your review."
    ),
  },
  "governance.performance": {
    title: "Performance reviews",
    body: helpBody(
      "Periodic summaries of agent task success rates, cost, and patterns. Generated by scheduler or POST /governance/performance/:agentId."
    ),
  },
  "governance.usage": {
    title: "LLM usage stats",
    body: helpBody(
      "Rollup of tokens and estimated USD from completed tasks in last 30 days, by agent."
    ),
  },
  "governance.audit": {
    title: "Audit log",
    body: helpBody(
      "Immutable-style event list: goal created, task completed, policy updated, etc. For compliance and debugging."
    ),
  },

  // ─── Workforce ───────────────────────────────────────────────────────
  "workforce.page": {
    title: "Workforce page",
    body: helpBody(
      "Delegate work from manager-owned parent goals to worker agents. Requires at least one manager agent with managedAgents configured.",
      "Creates child goals with instructions copied or customized per assignee."
    ),
    learnMore: "howto-workforce",
  },
  "workforce.parentGoal": {
    title: "Parent goal",
    body: helpBody(
      "Goal owned by a manager agent — delegation breaks it into sub-goals for workers."
    ),
  },
  "workforce.assignAgent": {
    title: "Assign to agent",
    body: helpBody(
      "Worker agent who receives the delegated child goal and executes browser tasks."
    ),
  },
  "workforce.instructions": {
    title: "Delegation instructions",
    body: helpBody(
      "Specific brief for this worker — overrides or narrows parent goal instructions."
    ),
  },
  "workforce.delegate": {
    title: "Delegate",
    body: helpBody(
      "Creates child goal(s) linked to parent. Workers see them on Goals page and can Run or receive via autonomy."
    ),
  },

  // ─── Operations ──────────────────────────────────────────────────────
  "ops.page": {
    title: "Operations",
    body: helpBody(
      "Monitor and configure the company event bus, automation triggers, and URL watchers.",
      "Foundation for reactive AI workforce: something happens → trigger fires → task or event."
    ),
    learnMore: "howto-operations",
  },
  "ops.events": {
    title: "Events tab",
    body: helpBody(
      "Chronological feed of CompanyEvent records: task.completed, watcher.change, training.requested, user.note, etc.",
      "Emit manually for testing or receive via webhook from CRM, Zapier, your app."
    ),
  },
  "ops.emitType": {
    title: "Event type",
    body: helpBody(
      "Dot-namespaced identifier (order.created, support.escalated). Triggers filter on this string."
    ),
  },
  "ops.emitSummary": {
    title: "Event summary",
    body: helpBody(
      "Human-readable one-liner stored on the event and shown in feeds."
    ),
  },
  "ops.emit": {
    title: "Emit event",
    body: helpBody(
      "Creates event with source=user, runs trigger engine matching rules, may enqueue tasks.",
      "Trigger tasks appear in Chats under threads titled Trigger · … — click Open chat thread on events below after tasks run."
    ),
  },
  "ops.triggers": {
    title: "Triggers tab",
    body: helpBody(
      "Automation rules: types include time, event, condition, threshold, change, anomaly. Actions: enqueue_task, emit_event, etc.",
      "Quick-add creates a basic event→enqueue_task rule; edit via API for advanced config."
    ),
  },
  "ops.triggerName": {
    title: "Trigger name",
    body: helpBody(
      "Label for your reference in lists."
    ),
  },
  "ops.triggerAdd": {
    title: "Add trigger",
    body: helpBody(
      "Creates an event trigger: when the bus receives the event type (IF), enqueue a browser task on the chosen agent (THEN).",
      "Optionally set a completion event type so when that task finishes, YamBot emits it on the bus and can fire another trigger (e.g. crm.logout.done)."
    ),
  },
  "ops.triggerEventType": {
    title: "Listen for event type",
    body: helpBody(
      "Exact event type that fires this trigger — must match an emitted event (goal completion type, task.completed, manual emit, webhook)."
    ),
  },
  "ops.triggerAgent": {
    title: "Agent for follow-up task",
    body: helpBody(
      "Which agent's cloud browser runs the task when the trigger fires. Required for enqueue_task."
    ),
  },
  "ops.triggerTask": {
    title: "Follow-up task text",
    body: helpBody(
      "Plain-English goal sent to the agent when the trigger fires (e.g. 'Log out of CRM'). Reuses the same chat when the event payload includes chatId."
    ),
  },
  "ops.triggerCompletionEvent": {
    title: "Completion event type",
    body: helpBody(
      "Optional. When this trigger's enqueued task finishes successfully, YamBot emits this event on the bus (e.g. crm.logout.done). Use it to chain another trigger: IF crm.logout.done → next step."
    ),
  },
  "ops.outcomeRouting": {
    title: "LLM outcome routing",
    body: helpBody(
      "When this trigger's task completes, your LLM classifies the agent result into one branch and emits that event.",
      "Use with downstream IF event triggers — e.g. weather.cold → send jacket reminder. Success/failure completion events still fire if configured."
    ),
    learnMore: "howto-operations",
  },
  "ops.outcomeBranch": {
    title: "Outcome branch",
    body: helpBody(
      "Event type to emit when the LLM decides this branch matches the result. 'When' describes the condition in plain English for the classifier."
    ),
  },
  "ops.completionActions": {
    title: "Completion actions",
    body: helpBody(
      "When this trigger's task completes, run parallel follow-ups (instructions or goals) with parent result in {{result}}.",
      "Rules match keywords/regex; LLM picks which actions to run."
    ),
    learnMore: "howto-operations",
  },
  "ops.completionAction": {
    title: "Completion action",
    body: helpBody(
      "Label, success/failure filter, when condition, optional agent, and instruction text or goal to run."
    ),
  },
  "ops.triggerEdit": {
    title: "Edit trigger",
    body: helpBody(
      "Loads this trigger into the form above so you can change the event type, agent, task text, or completion event. Save changes or Cancel to discard."
    ),
  },
  "ops.watcherAgent": {
    title: "Watcher agent",
    body: helpBody(
      "Agent associated with this URL monitor (required by API)."
    ),
  },
  "ops.watchers": {
    title: "Watchers tab",
    body: helpBody(
      "Poll URLs on interval; hash content; emit watcher.change when page changes. Good for status pages, competitor pricing HTML."
    ),
  },
  "ops.watcherUrl": {
    title: "Watcher URL",
    body: helpBody(
      "Full HTTPS URL to fetch server-side. Respects reasonable intervals (default 30 min)."
    ),
  },
  "ops.watcherAdd": {
    title: "Watch URL",
    body: helpBody(
      "Creates watcher and begins polling on scheduler ticks."
    ),
  },

  // ─── Company ─────────────────────────────────────────────────────────
  "company.page": {
    title: "Company page",
    body: helpBody(
      "World model + operating memory + process definitions for your AI workforce digital twin.",
      "Agents and investigation tools read entities and memory when reasoning about customers and facts."
    ),
    learnMore: "howto-company",
  },
  "company.entities": {
    title: "Entities",
    body: helpBody(
      "World-model records: name (required), type, kind, status, attributes, observations, territory group.",
      "Types: lead (prospect), customer (won), vendor (supplier), product (what you sell), process/document/ticket (secondary), custom (invented tables via kind).",
      "kind splits a type (lead+airlines, custom+weather). Filter Company by type and kind.",
      "Bulk CSV import creates/updates leads by email in the selected territory. Campaigns enroll that territory only."
    ),
  },
  "company.entityType": {
    title: "Entity type",
    body: helpBody(
      "Fixed list — you cannot invent new type strings.",
      "lead — prospect. customer — won account. vendor — supplier. product — offering.",
      "process / document / ticket — specialized; prefer Processes UI and Tickets queue when those fit better.",
      "custom — any invented dataset; set kind (weather, inventory) and put fields in attributes.",
      "Segments like airlines or corporate stay type lead with kind airlines / corporate."
    ),
  },
  "company.territoryFilter": {
    title: "Territory filter",
    body: helpBody(
      "Filter Company leads by agent group (country folder). All = every territory; Ungrouped = leads with no group; pick USA to see only that country's DB."
    ),
  },
  "company.entityKind": {
    title: "Kind (segment / table)",
    body: helpBody(
      "Optional free-text filter. Examples: airlines, corporate, travel_agency_leads, weather.",
      "Leave blank to see all kinds. Agents pass the same kind on create_entity / search_entities."
    ),
  },
  "company.csvImport": {
    title: "CSV lead import",
    body: helpBody(
      "Paste or upload CSV with email (required). Formats: email,name,company OR name,type,email (no header needed).",
      "Imports into the territory selected on the Entities tab (agent group). Up to 10,000 rows. Existing leads match on email within that territory.",
      "Example: Sunrise Travel,lead,support@vughy.com — or header row email,name,company"
    ),
  },
  "company.campaigns": {
    title: "Campaigns",
    body: helpBody(
      "Outbound email sequences tied to an agent. Activate a campaign, then Enroll all leads to queue every lead with an email.",
      "Scheduler sends batchSize emails per tick (~1/min). Replies via IMAP advance enrollment stage."
    ),
  },
  "company.entityName": {
    title: "Entity name",
    body: helpBody(
      "Display name for the record (Acme Corp, Lead #442)."
    ),
  },
  "company.memory": {
    title: "Company memory",
    body: helpBody(
      "Key-value facts (category + key + value) injected into autonomous loops — pricing policy, brand voice, fiscal year end.",
      "Unlike agent memory, these are org-wide truths."
    ),
  },
  "company.memoryKey": {
    title: "Memory key",
    body: helpBody(
      "Stable identifier (return_policy, main_competitor)."
    ),
  },
  "company.memoryValue": {
    title: "Memory value",
    body: helpBody(
      "Fact content the OS and agents should treat as authoritative."
    ),
  },
  "company.processes": {
    title: "Processes",
    body: helpBody(
      "Named workflows with steps — definitions for onboarding, support escalation, etc. Instances track running executions and bottlenecks.",
      "API supports bottleneck analysis for ops tuning."
    ),
  },
  "company.processName": {
    title: "Process name",
    body: helpBody(
      "Label for the process definition (Customer onboarding, Refund handling)."
    ),
  },

  // ─── Skills page ─────────────────────────────────────────────────────
  "skills.page": {
    title: "Skills",
    body: helpBody(
      "Reusable playbooks you create yourself (New skill, Generate with AI, or /learn in chat).",
      "Runs do not create suggested workflows. Set status to production when triggers and playbook are ready."
    ),
    learnMore: "howto-skills",
  },
  "skills.training": {
    title: "Training requests",
    body: helpBody(
      "Created when agent uses request_training action or worker API. Shows workflow gap observation. Mark done when you've recorded a demo or skill."
    ),
  },
  "skills.demos": {
    title: "Suggested workflows",
    body: helpBody(
      "Removed from the Skills page. Create skills manually instead of converting run trajectories."
    ),
  },
  "skills.convertDemo": {
    title: "Edit draft",
    body: helpBody(
      "Opens the draft skill linked to this workflow. If missing, creates a draft from demonstration steps."
    ),
  },
  "skills.deleteDemo": {
    title: "Delete demonstration",
    body: helpBody(
      "Removes this recorded Take-control session from the list.",
      "If you already converted it to a skill, that skill is kept."
    ),
  },
  "skills.list": {
    title: "Skills library",
    body: helpBody(
      "Named playbooks with SKILL.md content, slash commands (/slug), triggers, and replay steps.",
      "Production skills load on trigger match or explicit /slug in chat."
    ),
  },
  "skills.edit": {
    title: "Edit skill",
    body: helpBody(
      "Hermes-style SKILL.md playbook + triggers + replay steps. Set status to production when ready.",
      "Use Describe the skill in plain English → Generate with AI to draft the playbook, or Export/import SKILL.md for sharing.",
      "Slash command must match what you type in chat."
    ),
  },
  "skills.jobBrief": {
    title: "Skill brief (plain English)",
    body: helpBody(
      "Describe the reusable workflow. Generate with AI fills name, slash slug, description, SKILL.md playbook, triggers, steps, and verification rules.",
      "Status stays draft until you promote to production. Agent scope and execution mode stay yours to set.",
      "Unlike agent/goal briefs: this drafts a playbook injected when triggers match — not a full employee persona or one-off job."
    ),
  },
  "skills.slug": {
    title: "Slash command",
    body: helpBody(
      "Invoke this skill from chat with /slug — e.g. slug crm-followup → /crm-followup check leads.",
      "Must be unique per account. Auto-generated from name if left blank."
    ),
  },
  "skills.playbook": {
    title: "SKILL.md playbook",
    body: helpBody(
      "Hermes-style markdown: When to use, Procedure, Pitfalls, Verification.",
      "Injected into the worker prompt when the skill is matched or slash-invoked."
    ),
  },
  "skills.triggers": {
    title: "Skill triggers",
    body: helpBody(
      "One pattern per line — matched against goal text + current URL. Examples: crm\\.vughy\\.com, follow-up, logout"
    ),
  },
  "skills.steps": {
    title: "Skill steps",
    body: helpBody(
      "Hints mode: plain-English steps injected into the agent prompt (one per line).",
      "Replay mode: JSON action objects per line (navigate, click with xNorm/yNorm, type, key, scroll) — played back before the agent loop."
    ),
  },
  "skills.executionMode": {
    title: "Execution mode",
    body: helpBody(
      "Hints = inject steps into the LLM prompt only.",
      "Replay = run stored demo actions (click/type/navigate) on the live browser before the agent takes over."
    ),
  },
  "skills.enforceVerification": {
    title: "Enforce verification",
    body: helpBody(
      "When enabled, failed verification rules mark the task as failed (not just a warning in the summary)."
    ),
  },
  "skills.status": {
    title: "Skill status",
    body: helpBody(
      "draft = not injected; production = worker loads on matching tasks; deprecated = kept for history.",
      "Suggested workflows always start as draft — promote when triggers and playbook are ready."
    ),
  },
  "skills.agent": {
    title: "Skill agent",
    body: helpBody(
      "Optional — limit this skill to one agent. Leave blank for all agents on your account."
    ),
  },
  "skills.description": {
    title: "Skill description",
    body: helpBody("Short summary shown in the agent prompt with the step list.")
  },
  "skills.verification": {
    title: "Verification rules",
    body: helpBody(
      "Regex or plain-text checks against summary + trajectory.",
      "Warnings by default; enable Enforce verification to fail the task when a rule does not match."
    ),
  },
  "skills.production": {
    title: "Production skills",
    body: helpBody(
      "Only production skills are loaded by the cloud worker. Triggers must match before steps are injected."
    ),
  },
  "skills.save": {
    title: "Save skill",
    body: helpBody("Persists steps, triggers, and status for the worker to use on future tasks.")
  },
  "skills.name": {
    title: "Skill name",
    body: helpBody(
      "Short label (Checkout Amazon guest, Export CRM report)."
    ),
  },
  "skills.add": {
    title: "Add skill",
    body: helpBody(
      "Creates empty draft skill you can populate with steps manually or via demo conversion."
    ),
  },
  "skills.delete": {
    title: "Delete skill",
    body: helpBody(
      "Permanently removes this skill. `/slug` invoke in chat will no longer work.",
      "Demonstrations that were converted to this skill can be converted again. Past task history is kept."
    ),
  },

  // ─── Live & System ───────────────────────────────────────────────────
  "live.page": {
    title: "Live Wall",
    body: helpBody(
      "Grid of all active agents' cloud browser screenshots. Supervise parallel work, spot stuck CAPTCHAs, click through to agent chat.",
      "Updates on interval; not pixel-perfect video but sufficient for oversight."
    ),
    learnMore: "howto-live",
  },
  "system.page": {
    title: "System page",
    body: helpBody(
      "Cloud computer inventory and CPU charts. Regular users see only containers for agents they own.",
      "Super admins see every agent and platform container on the VPS."
    ),
    learnMore: "howto-system",
  },
  "system.restartWorker": {
    title: "Restart worker",
    body: helpBody(
      "Recreates that agent's Chromium container. Clears stuck browser state; in-flight task may error and requeue."
    ),
  },
};

/**
 * Full How To guide sections (anchor id = first arg in learnMore without prefix).
 * @type {Array<{ id: string, title: string, body: string }>}
 */
export const HOW_TO_SECTIONS = [
  {
    id: "overview",
    title: "What is YamBot?",
    body: helpBody(
      "YamBot is a cloud browser agent platform: you define AI employees (Agents), give them goals in natural language, and dedicated Chromium workers on your VPS execute those goals step by step — clicking, typing, reading pages, sending email, and calling HTTP APIs.",
      "Unlike a chatbot that only generates text, YamBot controls a real browser. You watch on Live Wall, answer questions when stuck, or Take control to handle CAPTCHAs and demos.",
      "The product layers: (1) Employee OS — Goals with KPIs and autonomy; (2) Governance — policies, budgets, approvals; (3) Workforce — manager delegation; (4) Integrations — HTTP, email, events; (5) Audit & spend tracking; plus Operations (event bus), Company (world model), and Skills (learned workflows)."
    ),
  },
  {
    id: "getting-started",
    title: "Getting started",
    body: helpBody(
      "1. Register / log in.",
      "2. Open Settings → add LLM API key, base URL, and model → Save.",
      "3. Optional: Vision LLM for screenshot recovery; DeathByCaptcha for some CAPTCHAs.",
      "4. Agents → New agent → fill Name, Skill, Profile, Standing instructions → Save.",
      "5. Chats → pick agent → New chat → type a goal → watch live screen.",
      "6. Optional: Policies for budgets and approval gates; Goals for recurring objectives."
    ),
  },
  {
    id: "howto-settings",
    title: "Settings & credentials",
    body: helpBody(
      "All agents under your account share LLM credentials from Settings unless you add per-agent email SMTP.",
      "Keys are encrypted in MongoDB and delivered to cloud workers only during task execution over authenticated worker API.",
      "confirmBeforeSubmit here is the org default for chat confirmation before risky clicks."
    ),
  },
  {
    id: "howto-create-agent",
    title: "How to create an agent (step by step)",
    body: helpBody(
      "Step 1: Go to Agents → New agent.",
      "Step 2: Name — pick a memorable role name.",
      "Step 3: Skill — one paragraph on capabilities ('Researches B2B pricing pages').",
      "Step 4: Profile — persona and tone ('You are meticulous, cite sources').",
      "Step 5: Standing instructions — hard rules ('Never checkout without approval').",
      "Step 6: Success criteria — default done conditions for tasks.",
      "Step 7: Optional Start URL and Allowed domains to constrain navigation.",
      "Step 8: Facts — stable key-values (login_portal_url, etc.).",
      "Step 9: Autonomy checkboxes — submit, CAPTCHA, login, vision per risk tolerance.",
      "Step 10: Optional Scheduler — recurring goal text + interval.",
      "Step 11: Optional Email — SMTP/IMAP for send_email/check_email actions.",
      "Step 12: Save — wait for cloud container; open chat or Live Wall to verify.",
      "Each agent = one cloud computer. Create separate agents for separate roles or security boundaries."
    ),
  },
  {
    id: "howto-agents",
    title: "Understanding agents",
    body: helpBody(
      "An agent is three things at once: (a) a configuration document — persona, policies, memory; (b) a task queue consumer; (c) a Docker Chromium instance on the VPS.",
      "Tasks are claimed atomically: one running task per agent. Priority comes from goal priority, SLA breaches, and priority arbitrator.",
      "Deleting an agent removes its container. Inactive flag pauses scheduling but does not delete infrastructure."
    ),
  },
  {
    id: "howto-chats",
    title: "How chats & tasks work",
    body: helpBody(
      "Chat message → Task created (pending) → cloud worker claims → status running → agent loop: observe page → LLM chooses action → execute in Playwright → repeat until finish or error.",
      "Statuses: pending, running, waiting_user (needs your answer), done, error, cancelled, blocked (waiting on dependsOn).",
      "Stop cancels running only. Answer unblocks waiting_user. Take control sends your input to the browser.",
      "Right rail: queue, live screen, DOM snapshot, trajectory for debugging."
    ),
  },
  {
    id: "howto-goals",
    title: "What are goals?",
    body: helpBody(
      "Goals are durable assignments — the Employee OS layer. They survive beyond one chat message and track KPIs, priority, SLA, and run statistics.",
      "Use goals when: work repeats on a schedule, you need KPI tracking, manager delegation, or autonomy should self-spawn tasks when metrics slip.",
      "Run button enqueues one task now. Autonomy enabled runs periodic checks without you.",
      "Difference from chat: chat is conversational and ephemeral; goal is a managed objective with identity in Governance and Workforce."
    ),
  },
  {
    id: "howto-autonomy",
    title: "Goal autonomy & manager autonomy",
    body: helpBody(
      "Goal autonomy: scheduler reads active goals with autonomy.enabled, compares KPIs and last check time, may enqueue tasks or emit events.",
      "Manager autonomy: manager agents react to recent company events and may create delegated goals for managed workers (rate-limited by scheduler).",
      "Both require careful policy budgets to avoid runaway LLM spend."
    ),
  },
  {
    id: "howto-skills",
    title: "What are skills?",
    body: helpBody(
      "Two related concepts:",
      "A) Agent edit → Skill field: free-text capability description for the LLM every run.",
      "B) Skills page: structured workflow library — steps, triggers, demonstrations, training requests.",
      "Workflow: agent hits unknown UI → training request → Open chat → Teach skill (record demo) → convert/edit draft → set production → worker injects steps when triggers match goal/URL. Successful runs do not auto-create skills.",
      "Skills are how institutional knowledge transfers from humans to the workforce without rewriting prompts each time."
    ),
  },
  {
    id: "howto-workforce",
    title: "Workforce & delegation",
    body: helpBody(
      "Set agent role Manager, select managedAgents (workers). Create parent goal owned by manager. Workforce page: pick parent, assign worker, add instructions → Delegate creates child goal for worker agent.",
      "Child goals inherit hierarchy for reporting. Workers execute browser tasks on their own cloud computers."
    ),
  },
  {
    id: "howto-operations",
    title: "Operations: events, triggers, watchers",
    body: helpBody(
      "Events: universal bus. Emit from UI, worker completes, webhooks POST /api/events/webhook with { type, summary, payload }.",
      "Triggers: when event type matches (or cron/time), action runs — typically enqueue_task with goal text in actionConfig.",
      "Watchers: HTTP poll URL; content hash change emits watcher.change → can trigger downstream automation.",
      "Together they turn YamBot from 'chat-only' into reactive operations center."
    ),
  },
  {
    id: "howto-company",
    title: "Company: entities, memory, processes",
    body: helpBody(
      "Entities: CRM-like records with observation timeline — 'as of March, status was trial'.",
      "Company memory: org facts key-value for prompts and autonomy.",
      "Processes: document SOPs as steps; track instances and bottlenecks.",
      "Investigation action on worker aggregates multi-source evidence with contradiction detection."
    ),
  },
  {
    id: "howto-policies",
    title: "Policies & agent policy overrides",
    body: helpBody(
      "Org Policies: approvals, budgets, URL blocks, HTTP allowlist, escalation.",
      "Agent edit policy section overrides monthly/daily budget, max task minutes, require approval.",
      "Effective policy merges both layers in runtime-config for workers.",
      "Economic stop: worker compares estimated task value vs LLM spend; time budget from maxTaskMinutes."
    ),
  },
  {
    id: "howto-governance",
    title: "Governance & oversight",
    body: helpBody(
      "Audit: who changed what. Approvals: human gate on risky clicks. Budget dashboard: monthly spend.",
      "Improvement proposals: autonomous suggestions after failures — approve before treating as accepted.",
      "Performance reviews: periodic agent scorecards from task history.",
      "Use Governance weekly for cost and compliance review."
    ),
  },
  {
    id: "howto-live",
    title: "Live Wall supervision",
    body: helpBody(
      "Open Live Wall to see all agents at once. Click agent to jump to chat. Best for ops floor monitoring.",
      "If screen frozen, check System for container health or restart worker."
    ),
  },
  {
    id: "howto-system",
    title: "System & troubleshooting",
    body: helpBody(
      "API health should return ok. Each agent should show a worker container when active.",
      "After deploy, confirm new UI here. Restart worker if browser zombie. Check Settings LLM if tasks error immediately.",
      "Stuck running tasks requeue after timeout automatically."
    ),
  },
  {
    id: "howto-wallet",
    title: "Wallet & Stripe billing",
    body: helpBody(
      "Each user has a prepaid wallet (USD). Top up via Wallet → Pay with Stripe (requires STRIPE_SECRET_KEY and webhook on server).",
      "Super-admin sets price per agent at /admin/users. When a user creates an agent, that amount is debited once. Insufficient balance returns HTTP 402 — top up first.",
      "Super-admin can grant free credits to any user without Stripe. Configure Stripe webhook: POST https://your-api/api/wallet/webhook with checkout.session.completed."
    ),
  },
  {
    id: "howto-superadmin",
    title: "Super-admin (SaaS operator)",
    body: helpBody(
      "Platform operators use /admin/login with a superadmin account to see all registered users, agent counts, tasks, and LLM spend.",
      "On the server deploy/.env set SUPERADMIN_BOOTSTRAP_EMAIL and SUPERADMIN_BOOTSTRAP_PASSWORD (min 8 chars) — created on API boot if missing. Or add emails to SUPERADMIN_EMAILS to promote existing accounts.",
      "Super-admins also see a Super admin link in the sidebar. Tenant users cannot access /api/admin or other users' data."
    ),
  },
  {
    id: "glossary",
    title: "Glossary",
    body: helpBody(
      "Agent — AI employee + cloud browser. Task — single browser job. Goal — durable objective. Chat — message thread. Skill — workflow playbook. Event — bus message. Trigger — automation rule. Watcher — URL monitor. Entity — world model record. Policy — governance rule. Approval — human gate. Demonstration — recorded human steps. Training request — agent asks for help learning."
    ),
  },
];

/**
 * @param {string} id
 * @returns {HelpEntry|undefined}
 */
export function getHelp(id) {
  return HELP[id];
}

/**
 * @param {string} sectionId
 * @returns {{ id: string, title: string, body: string }|undefined}
 */
export function getHowToSection(sectionId) {
  return HOW_TO_SECTIONS.find((s) => s.id === sectionId);
}
