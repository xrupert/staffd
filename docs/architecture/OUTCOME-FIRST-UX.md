# STAFFD Outcome-First UX

## Product rule

Customers brief staff. They do not operate Twenty, Chatwoot, Listmonk, Plausible, Docuseal, Postiz, muapi, or OpenMontage.

Those systems are implementation details behind capability harnesses. Customer-facing surfaces describe the job, the decision required from the owner, the evidence collected, and the result.

## Expansion packs

Industry packs are part of the same STAFFD operating system. They must not create separate applications, navigation systems, or duplicate staff experiences.

A pack may be an entitlement for commercial purposes, but when active it silently improves:

- specialist selection;
- mission templates;
- terminology;
- compliance rules;
- success criteria;
- recommended follow-on work;
- default artifacts and checklists.

The user should experience "my staff understands my business," not "I installed a plugin."

## Information architecture

### Command Center

The universal entry point. Users state an outcome in ordinary language or select a common mission template.

Examples:

- Follow up with every warm lead.
- Launch a promotion for my slowest weekday.
- Handle today's urgent customer questions.
- Send this agreement for signature.
- Produce a viral-ready video for my product.

### Work Board

Shows missions and evidence, not vendor jobs:

- Planned
- Working
- Waiting on you
- Reviewing
- Done
- Needs attention

Each mission card shows owner-facing progress, next action, budget/cost state, and produced artifacts.

### Connections

The settings surface may show which business capabilities are ready. Vendor names belong only in an expandable technical-details area.

Preferred labels:

- Customer relationships
- Support inbox
- Email campaigns
- Website analytics
- Electronic signatures
- Social publishing
- Video production

Each capability shows:

- Ready / Needs attention / Not connected
- What STAFFD can do with it
- Last successful evidence
- Repair connection action
- Technical details (progressively disclosed)

## Laws of UX applied

### Hick's Law

Do not place every integration or department on the primary decision surface. Show a short list of likely outcomes based on business context, active packs, and available capabilities.

### Jakob's Law

Use familiar business language: inbox, campaign, leads, signatures, calendar, approvals. Do not invent AI-specific navigation.

### Miller's Law

Group work into missions and present no more than a small number of immediate actions. Hide secondary controls under "More" or contextual drill-down.

### Recognition over recall

Show example requests, suggested outcomes, recent missions, and reusable templates. Never require the owner to remember command syntax.

### Progressive disclosure

Show the outcome and next decision first. Reveal departments, workers, harnesses, providers, retries, and raw evidence only when requested.

### Peak-end rule

Every mission should end with a clear completion moment: what was produced, what changed, evidence, and the recommended next move.

### Error prevention and recovery

Outbound or destructive actions require human approval. Failures confess the degraded path, preserve drafts, and offer a specific repair or retry action.

## Capability routing

A staff outcome declares abstract capabilities such as `crm.read`, `email.send`, or `support.reply`.

The Chief Orchestrator:

1. identifies the desired outcome;
2. activates industry-pack context;
3. verifies required capability harnesses;
4. builds the mission graph;
5. pauses for missing connection or approval;
6. executes through the harness layer;
7. grades evidence;
8. repairs or escalates;
9. presents the result without vendor jargon.

This keeps mission logic independent from the current vendor and makes vendor replacement possible without changing the customer experience.
