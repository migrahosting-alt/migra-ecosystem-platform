import type {
  ActivityEntry,
  Assistant,
  Attachment,
  CompletedRun,
  Conversation,
  Project,
  ResearchAnswer,
  RunOutput,
  RunStep,
  ScopeRequest,
  Topic,
  UploadedFile,
  User,
} from './types'

export const currentUser: User = {
  name: 'Emma Johnson',
  email: 'emma.johnson@migrapilot.io',
  plan: 'Free',
}

/* ------------------------------------------------------------------ *
 * Conversations
 * ------------------------------------------------------------------ */

const architectureImage: Attachment = {
  id: 'att-architecture',
  name: 'Architecture Diagram.png',
  kind: 'image',
  size: '1.2 MB',
  preview: 'architecture',
  uploadedAt: 'Today',
}

const briefingAudio: Attachment = {
  id: 'att-briefing',
  name: 'Project Briefing.m4a',
  kind: 'audio',
  size: '2.4 MB',
  duration: '01:45',
  uploadedAt: 'Today',
}

export const mediaLibrary: Attachment[] = [
  architectureImage,
  briefingAudio,
  {
    id: 'att-flowchart',
    name: 'Migration Flowchart.png',
    kind: 'image',
    size: '980 KB',
    preview: 'flowchart',
    uploadedAt: 'Yesterday',
  },
  {
    id: 'att-requirements',
    name: 'Requirements.docx',
    kind: 'document',
    size: '820 KB',
    uploadedAt: 'Yesterday',
  },
]

export const conversations: Conversation[] = [
  {
    id: 'launch-plan',
    title: 'Productivity App Launch Plan',
    preview: 'Built a three-phase launch plan for the new productivity app…',
    time: '10:24 AM',
    group: 'Today',
    icon: 'chat',
    tone: 'blue',
    messages: [
      {
        id: 'm1',
        role: 'user',
        text: 'Hi MigraPilot, can you help me write a launch plan for my new productivity app?',
        time: '10:24 AM',
        delivered: true,
      },
      {
        id: 'm2',
        role: 'assistant',
        time: '10:24 AM',
        blocks: [
          {
            type: 'paragraph',
            text: "Absolutely! Here's a comprehensive launch plan for your new productivity app, broken down into key phases.",
          },
          {
            type: 'list',
            variant: 'bullet',
            title: '1. Pre-Launch (4–6 Weeks Before Launch)',
            items: [
              'Define your target audience and core value proposition.',
              'Build a waitlist and start early email sign-ups.',
              'Create a landing page that explains the benefits and captures interest.',
              'Tease features on social media and engage with potential users.',
            ],
          },
          {
            type: 'list',
            variant: 'bullet',
            title: '2. Launch Week',
            items: [
              'Announce the launch across product hunt, social media, and email.',
              'Offer an exclusive launch discount or early access.',
              'Encourage users to share feedback and reviews.',
              'Host a live demo or AMA to generate excitement.',
            ],
          },
          {
            type: 'list',
            variant: 'bullet',
            title: '3. Post-Launch (Weeks 1–4)',
            items: [
              'Monitor user feedback and fix critical issues.',
              'Share user stories and testimonials.',
              'Roll out content marketing and how-to guides.',
              'Iterate based on analytics and user behavior.',
            ],
          },
          {
            type: 'paragraph',
            text: 'Would you like a timeline template or checklist to go with this plan?',
          },
        ],
        sources: [
          { id: 's1', title: 'Product Launch Strategy Guide', domain: 'hubspot.com' },
          { id: 's2', title: 'Top App Launch Tactics in 2024', domain: 'producthunt.com' },
        ],
      },
    ],
  },
  {
    id: 'migration-plan-review',
    title: 'Migration Plan Review',
    preview: 'Reviewed the architecture diagram and voice note…',
    time: '10:22 AM',
    group: 'Today',
    icon: 'chart',
    tone: 'purple',
    hasMedia: true,
    messages: [
      {
        id: 'm1',
        role: 'user',
        text: 'Hi MigraPilot, please review my migration diagram and voice note and give me a summary with suggested next steps.',
        time: '10:21 AM',
        delivered: true,
      },
      {
        id: 'm2',
        role: 'user',
        time: '10:22 AM',
        delivered: true,
        attachments: [architectureImage, briefingAudio],
      },
      {
        id: 'm3',
        role: 'assistant',
        time: '10:24 AM',
        blocks: [
          {
            type: 'paragraph',
            text: "Thanks for the diagram and voice note! Here's my analysis and recommendations:",
          },
          {
            type: 'list',
            variant: 'bullet',
            title: 'Visual Analysis Summary',
            titleIcon: 'chart',
            items: [
              'The architecture is **well-structured** and follows a modular microservices pattern.',
              'API Gateway is correctly positioned as the single entry point.',
              'Data Service depends on the Database and Storage—consider retries and caching.',
              'No cache layer detected—adding one (e.g., Redis) could improve performance.',
              'Ensure Auth Service is stateless and scalable behind the gateway.',
            ],
          },
          {
            type: 'list',
            variant: 'numbered',
            title: 'Suggested Next Steps',
            titleIcon: 'rocket',
            items: [
              'Add a caching layer between API Gateway and Data Service.',
              'Implement resilience (timeouts, retries, circuit breakers).',
              'Set up CI/CD pipeline and environment promotion strategy.',
              'Plan monitoring and centralized logging.',
            ],
          },
        ],
      },
    ],
  },
  {
    id: 'migration-strategy',
    title: 'Migration Strategy Discussion',
    preview: 'We discussed the phased migration approach for your application to the cloud…',
    time: '10:24 AM',
    group: 'Today',
    icon: 'chat',
    tone: 'blue',
    messages: [
      {
        id: 'm1',
        role: 'user',
        text: 'What phased approach would you recommend for migrating our application to the cloud?',
        time: '10:20 AM',
        delivered: true,
      },
      {
        id: 'm2',
        role: 'assistant',
        time: '10:24 AM',
        blocks: [
          {
            type: 'paragraph',
            text: 'A phased migration keeps risk low while delivering value early. Here is the sequence I would recommend for your workload.',
          },
          {
            type: 'list',
            variant: 'numbered',
            title: 'Recommended Phases',
            items: [
              'Assess and inventory every service, dependency, and data store.',
              'Move stateless services first to prove the landing zone.',
              'Migrate data with dual-write and a verified cutover window.',
              'Decommission legacy infrastructure once parity is confirmed.',
            ],
          },
        ],
      },
    ],
  },
  {
    id: 'seo-outline',
    title: 'SEO Content Outline',
    preview: 'Created a comprehensive outline for your blog post about productivity tips…',
    time: '9:15 AM',
    group: 'Today',
    icon: 'doc',
    tone: 'blue',
    messages: [
      {
        id: 'm1',
        role: 'user',
        text: 'Draft an SEO outline for a blog post about productivity tips for remote teams.',
        time: '9:15 AM',
        delivered: true,
      },
      {
        id: 'm2',
        role: 'assistant',
        time: '9:15 AM',
        blocks: [
          {
            type: 'paragraph',
            text: "Here's an outline structured around search intent, with a primary keyword of *remote team productivity*.",
          },
          {
            type: 'list',
            variant: 'bullet',
            title: 'Proposed Sections',
            items: [
              'Hook: the hidden cost of asynchronous overhead.',
              'Five habits that compound across a distributed team.',
              'Tooling: what to standardise and what to leave flexible.',
              'Measuring output without surveillance.',
            ],
          },
        ],
      },
    ],
  },
  {
    id: 'product-requirements',
    title: 'Product Requirements Draft',
    preview: "Here's the first draft of the product requirements document for the new feature…",
    time: '8:02 AM',
    group: 'Today',
    icon: 'doc',
    tone: 'green',
    messages: [
      {
        id: 'm1',
        role: 'user',
        text: 'Draft a PRD for the scoped-approval feature.',
        time: '8:02 AM',
        delivered: true,
      },
      {
        id: 'm2',
        role: 'assistant',
        time: '8:02 AM',
        blocks: [
          {
            type: 'paragraph',
            text: 'Draft PRD below. The core requirement is that no file is written without a signed, expiring scope approval.',
          },
          {
            type: 'list',
            variant: 'bullet',
            title: 'Requirements',
            items: [
              'Every run must present its full file scope before execution.',
              'Approvals expire and are bound to a scope hash.',
              'Any change outside the approved set halts the run.',
              'All approvals and rejections are written to an audit log.',
            ],
          },
        ],
      },
    ],
  },
  {
    id: 'market-research',
    title: 'Market Research Summary',
    preview: 'Summarized the latest market trends and key insights from our research…',
    time: 'Yesterday',
    group: 'Yesterday',
    icon: 'chart',
    tone: 'amber',
    messages: [
      {
        id: 'm1',
        role: 'user',
        text: 'Summarise the key market trends from the research folder.',
        time: '4:30 PM',
        delivered: true,
      },
      {
        id: 'm2',
        role: 'assistant',
        time: '4:31 PM',
        blocks: [
          {
            type: 'paragraph',
            text: 'Three trends dominate the current cycle across the sources you shared.',
          },
          {
            type: 'list',
            variant: 'bullet',
            items: [
              'Buyers increasingly demand auditable AI actions over raw autonomy.',
              'Migration tooling is consolidating around managed control planes.',
              'Procurement cycles shortened where compliance evidence ships with the product.',
            ],
          },
        ],
      },
    ],
  },
  {
    id: 'email-campaign',
    title: 'Email Campaign Draft',
    preview: 'Created a welcome email sequence for your new users…',
    time: 'Yesterday',
    group: 'Yesterday',
    icon: 'mail',
    tone: 'amber',
    messages: [
      {
        id: 'm1',
        role: 'user',
        text: 'Write a five-part welcome email sequence for new users.',
        time: '2:10 PM',
        delivered: true,
      },
      {
        id: 'm2',
        role: 'assistant',
        time: '2:11 PM',
        blocks: [
          {
            type: 'paragraph',
            text: 'Here is a five-email sequence that moves a new user from signup to first meaningful outcome.',
          },
          {
            type: 'list',
            variant: 'numbered',
            items: [
              'Welcome and set one clear first action.',
              'Show the single highest-value workflow.',
              'Share a short customer story with a concrete result.',
              'Introduce collaboration and sharing.',
              'Invite to upgrade with usage-based framing.',
            ],
          },
        ],
      },
    ],
  },
  {
    id: 'data-analysis',
    title: 'Data Analysis Help',
    preview: 'Analyzed Q2 performance data and highlighted the outliers…',
    time: 'Yesterday',
    group: 'Yesterday',
    icon: 'sheet',
    tone: 'green',
    messages: [
      {
        id: 'm1',
        role: 'user',
        text: 'Analyse the Q2 performance data and highlight anything unusual.',
        time: '11:05 AM',
        delivered: true,
      },
      {
        id: 'm2',
        role: 'assistant',
        time: '11:06 AM',
        blocks: [
          {
            type: 'paragraph',
            text: 'Q2 tracked close to plan with two outliers worth attention.',
          },
          {
            type: 'list',
            variant: 'bullet',
            items: [
              'Week 7 conversion dropped 18% — coincides with the checkout deploy.',
              'Enterprise segment grew 34% against a flat mid-market.',
              'Refund rate is stable; the dip is acquisition-side, not product-side.',
            ],
          },
        ],
      },
    ],
  },
  {
    id: 'pitch-deck',
    title: 'Pitch Deck Review',
    preview: 'Reviewed investor pitch deck and tightened the narrative…',
    time: 'Tue',
    group: 'This Week',
    icon: 'doc',
    tone: 'purple',
    messages: [
      {
        id: 'm1',
        role: 'user',
        text: 'Review my investor pitch deck and tell me what is weak.',
        time: 'Tue 3:40 PM',
        delivered: true,
      },
      {
        id: 'm2',
        role: 'assistant',
        time: 'Tue 3:41 PM',
        blocks: [
          {
            type: 'paragraph',
            text: 'The product story is strong; the market slide is doing the least work.',
          },
          {
            type: 'list',
            variant: 'bullet',
            items: [
              'Slide 4 states a TAM without a bottom-up derivation — investors will discount it.',
              'The competitive slide lists features, not a wedge.',
              'Traction is buried on slide 11; move it to slide 3.',
            ],
          },
        ],
      },
    ],
  },
  {
    id: 'competitor-analysis',
    title: 'Competitor Analysis',
    preview: 'Analyzed top 5 competitors across pricing and positioning…',
    time: 'Mon',
    group: 'This Week',
    icon: 'doc',
    tone: 'purple',
    messages: [
      {
        id: 'm1',
        role: 'user',
        text: 'Analyse our top five competitors on pricing and positioning.',
        time: 'Mon 10:00 AM',
        delivered: true,
      },
      {
        id: 'm2',
        role: 'assistant',
        time: 'Mon 10:02 AM',
        blocks: [
          {
            type: 'paragraph',
            text: 'All five cluster around per-seat pricing, which leaves usage-based positioning open.',
          },
          {
            type: 'list',
            variant: 'bullet',
            items: [
              'Two competitors gate audit logs behind an enterprise tier.',
              'None publish scope-approval guarantees — this is your differentiator.',
              'Median entry price is $29/seat; the floor is unoccupied below $15.',
            ],
          },
        ],
      },
    ],
  },
  {
    id: 'customer-feedback',
    title: 'Customer Feedback',
    preview: 'Summarized customer feedback from the last 30 days…',
    time: 'Mon',
    group: 'This Week',
    icon: 'doc',
    tone: 'blue',
    messages: [
      {
        id: 'm1',
        role: 'user',
        text: 'Summarise the last 30 days of customer feedback.',
        time: 'Mon 9:15 AM',
        delivered: true,
      },
      {
        id: 'm2',
        role: 'assistant',
        time: 'Mon 9:16 AM',
        blocks: [
          {
            type: 'paragraph',
            text: 'Sentiment is positive overall, with one recurring friction point.',
          },
          {
            type: 'list',
            variant: 'bullet',
            items: [
              'Setup time is the most-praised attribute (41 mentions).',
              'Users want run history exportable as PDF (19 requests).',
              'Three enterprise accounts asked for SSO before renewal.',
            ],
          },
        ],
      },
    ],
  },
]

export function conversationById(id: string) {
  return conversations.find((conversation) => conversation.id === id)
}

/* ------------------------------------------------------------------ *
 * Files
 * ------------------------------------------------------------------ */

export const uploadedFiles: UploadedFile[] = [
  {
    id: 'f1',
    name: 'Migration Plan.pdf',
    size: '2.4 MB',
    meta: '24 pages',
    status: 'ready',
    pages: 24,
    bytes: 2.4,
  },
  {
    id: 'f2',
    name: 'Client Data.xlsx',
    size: '1.1 MB',
    meta: 'Sheet1',
    status: 'ready',
    pages: 0,
    bytes: 1.1,
  },
  {
    id: 'f3',
    name: 'Requirements.docx',
    size: '820 KB',
    meta: '12 pages',
    status: 'ready',
    pages: 12,
    bytes: 0.82,
  },
]

export const detectedTopics: Topic[] = [
  { label: 'Migration Planning', tone: 'blue', icon: 'calendar' },
  { label: 'Data Management', tone: 'green', icon: 'sheet' },
  { label: 'System Integration', tone: 'purple', icon: 'integration' },
  { label: 'Security & Compliance', tone: 'amber', icon: 'shield' },
  { label: 'Training & Adoption', tone: 'cyan', icon: 'book' },
]

export const keyPoints = [
  'Migration timeline targets Q3 2025 go-live.',
  '125 client records identified for migration.',
  'Data mapping covers 18 core fields.',
  'Security and compliance requirements included.',
  'Dependencies include API integrations and user training.',
]

export const analysisSummary =
  'This set of documents outlines a structured migration plan with clear timelines, data requirements, and technical dependencies. The focus is on data accuracy, system integration, and user readiness to ensure a smooth transition.'

/* ------------------------------------------------------------------ *
 * Governed run
 * ------------------------------------------------------------------ */

export const scopeRequest: ScopeRequest = {
  approvalId: 'MP-7F3A-2C9D-8B6E',
  expires: 'May 23, 2025 at 11:59 PM (PT)',
  files: [
    {
      path: 'src/services/migrationService.ts',
      evidence: 'Updates migration flow to include retry logic and structured logging.',
      detail:
        'Adds exponential backoff around the batch transfer loop and emits structured events for each attempt so failures are traceable in the run log.',
      approved: true,
    },
    {
      path: 'config/migration-config.json',
      evidence: 'Adds new source system endpoint and timeout configuration.',
      detail:
        'Introduces the legacy source endpoint, a 30s request timeout, and a concurrency ceiling of 4 workers.',
      approved: true,
    },
    {
      path: 'db/migrations/20240515_add_audit.sql',
      evidence: 'Creates audit table to track migration job status.',
      detail:
        'Creates migration_audit with run id, scope hash, actor, decision, and timestamp columns, plus an index on run id.',
      approved: true,
    },
  ],
}

export const runSteps: RunStep[] = [
  {
    id: 'planning',
    title: 'Planning',
    description: 'Analyzing requirements and preparing execution plan.',
    status: 'complete',
    duration: '2m 14s',
  },
  {
    id: 'scope',
    title: 'Scope Approved',
    description: 'Migration scope reviewed and approved.',
    status: 'complete',
    duration: '1m 02s',
  },
  {
    id: 'apply',
    title: 'Applying Changes',
    description: 'Generating and applying code changes.',
    status: 'active',
    progress: 34,
  },
  {
    id: 'validate',
    title: 'Validation',
    description: 'Running validations and quality checks.',
    status: 'pending',
  },
  {
    id: 'repair',
    title: 'Repair',
    description: 'Auto-repairing issues, if any.',
    status: 'pending',
  },
]

export const runActivity: ActivityEntry[] = [
  { id: 'a1', time: '10:24:18 AM', label: 'Migration plan created', status: 'completed' },
  { id: 'a2', time: '10:24:42 AM', label: 'Scope approved by user', status: 'completed' },
  { id: 'a3', time: '10:25:03 AM', label: 'Applying changes to 42 files', status: 'in-progress' },
  { id: 'a4', time: '10:25:19 AM', label: 'Validating changes', status: 'pending' },
  { id: 'a5', time: '10:25:19 AM', label: 'Repair (if needed)', status: 'pending' },
]

export const runOutputs: RunOutput[] = [
  { id: 'o1', name: 'migration-log.txt', size: '18 KB' },
  { id: 'o2', name: 'changes-summary.json', size: '32 KB' },
  { id: 'o3', name: 'validation-report.html', size: '48 KB' },
]

export const activeRun = {
  id: 'RUN-2025-05-21-1024',
  started: 'May 21, 2025 10:24 AM',
  estimated: '~ 00:03:12',
  filesInScope: 42,
  filesApplying: 14,
  filesPending: 28,
}

export const completedRun: CompletedRun = {
  id: 'RUN-2025-05-16-1432',
  revision: 'a3f7c2d',
  started: 'May 16, 2025 • 2:32 PM',
  completed: 'May 16, 2025 • 2:35 PM',
  duration: '2m 47s',
  environment: 'Production',
  filesChanged: 18,
  validationsPassed: 18,
  validationsTotal: 18,
  warnings: 0,
  linesModified: 2531,
  fixes: [
    'Resolved deprecated API usage in 8 files',
    'Updated configuration formats to latest standards',
    'Fixed compatibility issues across 3 modules',
    'Improved error handling and logging',
    'Aligned code style and formatting',
  ],
  changedFiles: [
    { path: 'src/api/client.js', added: 142, removed: 23 },
    { path: 'src/services/auth.service.ts', added: 198, removed: 45 },
    { path: 'src/utils/validators.ts', added: 86, removed: 10 },
    { path: 'config/app.config.json', added: 34, removed: 5 },
    { path: 'tests/auth.service.test.ts', added: 67, removed: 8 },
  ],
}

/* ------------------------------------------------------------------ *
 * Projects & assistants
 * ------------------------------------------------------------------ */

export const projects: Project[] = [
  {
    id: 'website-launch',
    name: 'Website Launch',
    description: 'Planning, content, and assets for our new website.',
    progress: 75,
    tone: 'blue',
    icon: 'globe',
    members: ['Emma Johnson', 'Marcus Reed', 'Aisha Patel', 'Tom Vance', 'Lena Fischer'],
    updated: 'Updated 2h ago',
    starred: true,
    files: 12,
    chats: 24,
  },
  {
    id: 'product-roadmap',
    name: 'Product Roadmap',
    description: 'Features, timelines, and strategic priorities.',
    progress: 60,
    tone: 'green',
    icon: 'trend',
    members: ['Marcus Reed', 'Emma Johnson', 'Priya Nair'],
    updated: 'Updated 5h ago',
    starred: false,
    files: 8,
    chats: 16,
  },
  {
    id: 'support-docs',
    name: 'Support Docs',
    description: 'FAQs, guides, and customer help content.',
    progress: 45,
    tone: 'purple',
    icon: 'book',
    members: ['Aisha Patel', 'Emma Johnson', 'Tom Vance', 'Lena Fischer', 'Kai Moreau', 'Ines Ruiz'],
    updated: 'Updated 1d ago',
    starred: false,
    files: 5,
    chats: 11,
  },
  {
    id: 'codebase-review',
    name: 'Codebase Review',
    description: 'Analyze, refactor, and improve code quality.',
    progress: 30,
    tone: 'amber',
    icon: 'code',
    members: ['Emma Johnson', 'Marcus Reed', 'Priya Nair'],
    updated: 'Updated 2d ago',
    starred: false,
    files: 2,
    chats: 7,
  },
]

export const workspaceStats = {
  totalProjects: 4,
  activeToday: 3,
  totalFiles: 27,
  totalChats: 58,
}

export const recentActivity = [
  { id: 'ra1', project: 'Website Launch', detail: 'You asked a question', time: '2h ago', tone: 'blue' as const, icon: 'globe' as const },
  { id: 'ra2', project: 'Product Roadmap', detail: 'File updated: roadmap.pdf', time: '5h ago', tone: 'green' as const, icon: 'trend' as const },
  { id: 'ra3', project: 'Support Docs', detail: 'New file added: faq.md', time: '1d ago', tone: 'purple' as const, icon: 'book' as const },
  { id: 'ra4', project: 'Codebase Review', detail: 'You asked a question', time: '2d ago', tone: 'amber' as const, icon: 'code' as const },
]

export const assistants: Assistant[] = [
  {
    id: 'writing-coach',
    name: 'Writing Coach',
    description: 'Improve writing, clarity, and communication.',
    chats: 12,
    tone: 'blue',
    icon: 'pencil',
  },
  {
    id: 'research-assistant',
    name: 'Research Assistant',
    description: 'Find, summarize, and analyze information.',
    chats: 8,
    tone: 'green',
    icon: 'search',
  },
  {
    id: 'coding-helper',
    name: 'Coding Helper',
    description: 'Get help with code, debugging, and best practices.',
    chats: 15,
    tone: 'blue',
    icon: 'code',
  },
  {
    id: 'business-planner',
    name: 'Business Planner',
    description: 'Plan strategies, business models, and growth.',
    chats: 6,
    tone: 'amber',
    icon: 'briefcase',
  },
]

/* ------------------------------------------------------------------ *
 * Research
 * ------------------------------------------------------------------ */

export const researchAnswer: ResearchAnswer = {
  question:
    'What are the key steps and best practices for migrating from SharePoint Server to SharePoint Online?',
  summary:
    'Migrating from SharePoint Server to SharePoint Online involves planning, preparation, data migration, and post-migration optimization.',
  steps: [
    {
      title: 'Assess and Plan',
      text: 'Inventory your content, analyze dependencies, and define scope, timeline, and success criteria.',
      citations: [1],
    },
    {
      title: 'Prepare Your Environment',
      text: 'Set up your SharePoint Online tenant, configure permissions, storage, and security policies.',
      citations: [2, 3],
    },
    {
      title: 'Migrate Your Content',
      text: 'Use Microsoft Migration Manager or third-party tools to migrate sites, lists, libraries, and metadata.',
      citations: [1, 4],
    },
    {
      title: 'Validate and Test',
      text: 'Verify content integrity, permissions, and functionality. Run user acceptance testing before go-live.',
      citations: [2],
    },
    {
      title: 'Optimize and Adopt',
      text: 'Train users, update processes, and monitor adoption. Continuously optimize performance and governance.',
      citations: [3],
    },
  ],
  sources: [
    {
      n: 1,
      id: 'src-1',
      title: 'Microsoft Learn',
      description: 'SharePoint migration overview and best practices',
      domain: 'learn.microsoft.com',
    },
    {
      n: 2,
      id: 'src-2',
      title: 'Microsoft 365 Admin Center',
      description: 'Plan a SharePoint migration',
      domain: 'admin.microsoft.com',
    },
    {
      n: 3,
      id: 'src-3',
      title: 'SharePoint Migration Guide',
      description: 'Official Microsoft migration guide and checklist',
      domain: 'microsoft.com',
    },
    {
      n: 4,
      id: 'src-4',
      title: 'AvePoint Blog',
      description: 'Best practices for SharePoint Online migrations',
      domain: 'avepoint.com',
    },
  ],
  related: [
    'SharePoint Online limits',
    'Migration tools comparison',
    'Permissions mapping',
    'Post-migration checklist',
  ],
}
