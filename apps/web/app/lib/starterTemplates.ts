/**
 * Starter templates seeded for every new user on first visit to the Templates page.
 * Production-quality documents ready to use immediately or adapt.
 *
 * Vault placeholders are replaced at seed time via fillVaultData().
 */

export interface StarterTemplate {
  name: string;
  department: string;
  content: string;
}

export interface VaultSnapshot {
  business_name?: string;
  address?: string;
  phone?: string;
  primary_email?: string;
  website?: string;
}

/**
 * Replaces vault placeholder tokens in template content with actual business data.
 * Safe to call with a partial vault — unfilled placeholders remain as-is.
 */
export function fillVaultData(content: string, vault: VaultSnapshot): string {
  let out = content;

  if (vault.business_name?.trim()) {
    out = out
      .replace(/\[YOUR BUSINESS NAME\]/g, vault.business_name)
      .replace(/\[BUSINESS NAME\]/g, vault.business_name)
      .replace(/\[Company Name\]/g, vault.business_name);
  }
  if (vault.address?.trim()) {
    // Replace multi-line address placeholder with the address + remove the city/zip line
    out = out
      .replace(/\[Address Line 1\]\n\[City, State, ZIP\]/g, vault.address)
      .replace(/\[Address Line 1\]/g, vault.address)
      .replace(/\[City, State, ZIP\]/g, "")
      .replace(/\[Business Address\]/g, vault.address)
      .replace(/\[Address\]/g, vault.address);
  }
  if (vault.phone?.trim()) {
    out = out
      .replace(/\[Phone\]/g, vault.phone)
      .replace(/\[Phone Number\]/g, vault.phone)
      .replace(/\+1 \(555\) 000-0000/g, vault.phone);
  }
  if (vault.primary_email?.trim()) {
    out = out
      .replace(/\[Email\]/g, vault.primary_email)
      .replace(/\[Email Address\]/g, vault.primary_email)
      .replace(/hello@yourbusiness\.com/g, vault.primary_email)
      .replace(/billing@yourbusiness\.com/g, vault.primary_email);
  }
  if (vault.website?.trim()) {
    out = out
      .replace(/\[Website\]/g, vault.website)
      .replace(/yourbusiness\.com/g, vault.website);
  }
  return out;
}

export const STARTER_TEMPLATES: StarterTemplate[] = [

  // ─── Finance ──────────────────────────────────────────────────────────────────
  {
    name: "Professional Invoice",
    department: "finance",
    content: `# INVOICE

**[YOUR BUSINESS NAME]**
[Address Line 1]
[City, State, ZIP]
[Phone] | [Email]
[Website]

---

**INVOICE TO:**
[Client Name]
[Client Address]
[Client City, State, ZIP]

| | |
|---|---|
| **Invoice #** | INV-[NUMBER] |
| **Invoice Date** | [DATE] |
| **Due Date** | [DATE + 15 DAYS] |
| **Payment Terms** | Net 15 |

---

## Services

| Description | Qty | Rate | Amount |
|---|---|---|---|
| [Service Description] | 1 | $[RATE] | $[AMOUNT] |
| [Service Description] | 1 | $[RATE] | $[AMOUNT] |
| | | | |
| | | **Subtotal** | $[SUBTOTAL] |
| | | Tax ([%]) | $[TAX] |
| | | **Total Due** | **$[TOTAL]** |

---

## Payment Methods

- **Bank Transfer:** [Bank Name] | Account [NUMBER] | Routing [NUMBER]
- **Check:** Payable to [YOUR BUSINESS NAME]
- **Online:** [Payment link]

---

**Late Payment Policy:** Invoices unpaid after 15 days are subject to a 1.5% monthly late fee.

Thank you for your business.`,
  },

  // ─── Legal ────────────────────────────────────────────────────────────────────
  {
    name: "Mutual NDA",
    department: "legal",
    content: `# NON-DISCLOSURE AGREEMENT

**Note:** This is a starting draft. Have a licensed attorney review before using in any binding context.

This Mutual Non-Disclosure Agreement ("Agreement") is entered into as of [DATE] by and between:

**Party A:** [YOUR BUSINESS NAME], located at [Address] ("Company")

**Party B:** [COUNTERPARTY NAME], located at [Address] ("Counterparty")

(Each a "Party" and collectively the "Parties")

---

## 1. Purpose

The Parties wish to explore a potential business relationship (the "Purpose") and, in connection with this Purpose, each Party may disclose certain Confidential Information to the other Party.

## 2. Definition of Confidential Information

"Confidential Information" means any non-public information disclosed by either Party, whether in written, oral, electronic, or other form, that is designated as confidential or that reasonably should be understood to be confidential given the nature of the information and the circumstances of disclosure.

Confidential Information does not include information that: (a) is or becomes publicly available through no breach of this Agreement; (b) was rightfully known to the receiving Party prior to disclosure; (c) is independently developed by the receiving Party without reference to the Confidential Information; or (d) is required to be disclosed by law or court order, provided the receiving Party gives prompt written notice.

## 3. Obligations

Each Party agrees to: (a) hold the other Party's Confidential Information in strict confidence; (b) not disclose the Confidential Information to any third party without prior written consent; (c) use the Confidential Information solely for the Purpose; and (d) limit access to employees and contractors who have a need to know and are bound by confidentiality obligations at least as protective as this Agreement.

## 4. Term

This Agreement shall remain in effect for [2] years from the date of signing. Obligations regarding Confidential Information disclosed during this term shall survive for [3] years after expiration.

## 5. Return of Information

Upon request by either Party, the other Party shall promptly return or destroy all Confidential Information and any copies thereof.

## 6. No License

Nothing in this Agreement grants either Party any rights in or to the other Party's Confidential Information except as expressly stated herein.

## 7. Governing Law

This Agreement shall be governed by the laws of the State of [STATE], without regard to its conflict of law provisions.

---

**IN WITNESS WHEREOF**, the Parties have executed this Agreement as of the date first written above.

**[YOUR BUSINESS NAME]**
Signature: _________________________ Date: _______________
Name: [NAME] | Title: [TITLE]

**[COUNTERPARTY NAME]**
Signature: _________________________ Date: _______________
Name: [NAME] | Title: [TITLE]`,
  },

  {
    name: "Service Agreement",
    department: "legal",
    content: `# SERVICE AGREEMENT

This Service Agreement ("Agreement") is entered into as of [DATE] by and between:

**Service Provider:** [YOUR BUSINESS NAME], located at [Address] ("Provider")

**Client:** [CLIENT NAME], located at [Client Address] ("Client")

---

## 1. Services

Provider agrees to perform the following services for Client:

[Describe services in detail — be specific about what is and is not included]

## 2. Timeline

- **Project Start Date:** [DATE]
- **Estimated Completion:** [DATE]
- **Key Milestones:** [List milestones and dates]

## 3. Compensation

Client agrees to pay Provider as follows:

- **Total Fee:** $[AMOUNT]
- **Payment Schedule:** [e.g., 50% on signing, 50% on completion]
- **Payment Method:** [Bank transfer / check / online payment]
- **Late Fees:** A 1.5% monthly fee applies to invoices unpaid after [15] days.

## 4. Revisions

Provider will provide [NUMBER] rounds of revisions. Additional revisions will be billed at $[RATE] per hour.

## 5. Intellectual Property

Upon receipt of full payment, Client shall own all deliverables produced under this Agreement. Provider retains the right to display the work in its portfolio.

## 6. Confidentiality

Each party agrees to keep the other's confidential information in strict confidence and not to disclose it to any third party without prior written consent.

## 7. Limitation of Liability

Provider's total liability under this Agreement shall not exceed the total fees paid by Client in the [3] months preceding the claim.

## 8. Termination

Either party may terminate this Agreement with [14] days' written notice. Client shall pay for all work completed up to the termination date.

## 9. Governing Law

This Agreement shall be governed by the laws of the State of [STATE].

---

**[YOUR BUSINESS NAME]**
Signature: _________________________ Date: _______________
Name: [NAME] | Title: [TITLE]
Email: [Email]

**[CLIENT NAME]**
Signature: _________________________ Date: _______________
Name: [NAME] | Title: [TITLE]`,
  },

  // ─── Operations ───────────────────────────────────────────────────────────────
  {
    name: "Standard Operating Procedure",
    department: "operations",
    content: `# Standard Operating Procedure

**Process Name:** [PROCESS NAME]
**Department:** [DEPARTMENT]
**Owner:** [OWNER NAME / ROLE]
**Version:** 1.0
**Last Updated:** [DATE]
**Review Date:** [DATE + 6 MONTHS]

---

## Purpose

[1-2 sentences describing why this process exists and what problem it solves.]

## Scope

**Who uses this SOP:** [Role(s) responsible for executing this process]
**When to use this SOP:** [Trigger — what initiates this process]
**Tools required:** [List tools, software, logins needed]

---

## Procedure

### Step 1: [Step Name]
**Owner:** [Role]  |  **Time:** [~X minutes]

1. [Action]
2. [Action]
3. [Action]

**Outcome:** [What should be true after this step]

---

### Step 2: [Step Name]
**Owner:** [Role]  |  **Time:** [~X minutes]

1. [Action]
2. [Action]
3. [Action]

⚠️ **Decision required:** If [condition], do [A]. If [condition], do [B].

**Outcome:** [What should be true after this step]

---

### Step 3: [Step Name]
**Owner:** [Role]  |  **Time:** [~X minutes]

1. [Action]
2. [Action]
3. [Action]

**Outcome:** [What should be true after this step]

---

## Definition of Done

This process is complete when:
- [ ] [Condition 1]
- [ ] [Condition 2]
- [ ] [Condition 3]

## Exception Handling

| Exception | Action |
|---|---|
| [Scenario] | [What to do] |
| [Scenario] | [What to do] |

## Related Documents

- [Link or reference to related SOPs, policies, or resources]

---

*Questions about this SOP? Contact [Owner Name] at [Contact Info].*`,
  },

  // ─── Sales ────────────────────────────────────────────────────────────────────
  {
    name: "Sales Proposal",
    department: "sales",
    content: `# PROPOSAL

**Prepared by:** [YOUR BUSINESS NAME]
**Prepared for:** [CLIENT NAME]
**Date:** [DATE]
**Valid Until:** [DATE + 30 DAYS]

---

## Executive Summary

[2-3 sentences summarising the opportunity, the recommended solution, and the expected outcome for the client. Make them feel understood before they read a single detail.]

---

## Understanding Your Situation

Based on our conversations, here is what we understand about your current situation:

- **Current challenge:** [State the core problem as the client would describe it]
- **Impact:** [What this challenge is costing them — time, revenue, opportunity]
- **Goal:** [What they want to achieve in the next 90 days / 12 months]

---

## Our Recommended Solution

### What We Will Do

[Clear description of the engagement — what happens, in what order, and what you deliver]

### Why This Approach

[2-3 reasons this approach is the right one for their specific situation]

### What You Can Expect

| Timeframe | Outcome |
|---|---|
| Week 1-2 | [Early milestone] |
| Month 1 | [Progress marker] |
| Month 3 | [Key deliverable] |
| Ongoing | [Long-term value] |

---

## Investment

| Package | Includes | Investment |
|---|---|---|
| [Option A] | [What's included] | $[PRICE] |
| [Option B — Recommended] | [What's included] | $[PRICE] |

**Payment Terms:** [e.g., 50% on signing, 50% on first deliverable]

---

## About [YOUR BUSINESS NAME]

[3-4 sentences on who you are, what you specialise in, and why you are the right choice. Include a notable result or client win if possible.]

---

## Next Steps

1. Review and sign this proposal
2. Submit the initial payment to confirm your project start date
3. [First action after signing]

**Questions?** Reach us at [Email] | [Phone]

---

*[YOUR BUSINESS NAME] | [Address] | [Website]*`,
  },

  // ─── HR ───────────────────────────────────────────────────────────────────────
  {
    name: "Performance Review",
    department: "hr",
    content: `# PERFORMANCE REVIEW

**Employee Name:** [EMPLOYEE NAME]
**Role:** [ROLE / TITLE]
**Review Period:** [START DATE] — [END DATE]
**Reviewer:** [MANAGER NAME]
**Review Date:** [DATE]

---

## 1. Summary Rating

| Category | Rating (1–5) | Notes |
|---|---|---|
| Quality of Work | [RATING] | |
| Productivity | [RATING] | |
| Communication | [RATING] | |
| Initiative | [RATING] | |
| Teamwork | [RATING] | |
| **Overall** | **[RATING]** | |

*Rating Scale: 1 = Needs Improvement · 2 = Below Expectations · 3 = Meets Expectations · 4 = Exceeds Expectations · 5 = Outstanding*

---

## 2. Key Accomplishments This Period

[List 3-5 specific accomplishments with measurable impact where possible]

1.
2.
3.

---

## 3. Areas for Growth

[2-3 specific areas where improvement is needed, framed constructively]

1.
2.

---

## 4. Goals for Next Period

| Goal | Success Criteria | Target Date |
|---|---|---|
| [Goal 1] | [How we will measure it] | [DATE] |
| [Goal 2] | [How we will measure it] | [DATE] |
| [Goal 3] | [How we will measure it] | [DATE] |

---

## 5. Support & Development

**Training or resources needed:**
[What does this person need to succeed in the next period?]

**Manager support:**
[What will you commit to doing differently as their manager?]

---

## 6. Comments

**Employee comments:**
[Space for the employee to respond, add context, or share perspective]

---

**Reviewer Signature:** _________________________ Date: _______________

**Employee Signature:** _________________________ Date: _______________

*Signature indicates this review was discussed — not necessarily that the employee agrees with all ratings.*`,
  },

  // ─── Paid Media ───────────────────────────────────────────────────────────────
  {
    name: "Ad Campaign Brief",
    department: "paid-media",
    content: `# AD CAMPAIGN BRIEF

**Brand:** [YOUR BUSINESS NAME]
**Campaign Name:** [CAMPAIGN NAME]
**Prepared by:** [YOUR NAME / ROLE]
**Date:** [DATE]

---

## Campaign Overview

| | |
|---|---|
| **Objective** | [Awareness / Leads / Conversions / Retargeting] |
| **Budget** | $[AMOUNT] / [month / campaign] |
| **Flight Dates** | [START DATE] → [END DATE] |
| **Primary Platform** | [Google / Meta / TikTok / LinkedIn] |
| **Secondary Platform** | [If applicable] |

---

## Target Audience

**Primary audience:**
[Describe demographics, interests, behaviours, and pain points]

**Exclusions:**
[Who should NOT see these ads — existing customers, competitors, etc.]

**Lookalike / Custom audiences:**
[Any custom lists, retargeting segments, or lookalike sources]

---

## Offer & Messaging

**Core offer:**
[What are we promoting? Be specific — free trial, discount, service, product]

**Primary message / headline direction:**
[What is the single most important thing we want them to feel or understand?]

**Supporting messages (secondary):**
1.
2.

**Call to action:**
[Book a call / Start free trial / Get a quote / Shop now]

---

## Creative Direction

**Format(s):**
- [ ] Static image
- [ ] Video (length: ___ seconds)
- [ ] Carousel
- [ ] Story / Reel

**Visual style:**
[Describe the look and feel — photography vs. graphic, tone, energy]

**Copy tone:**
[Professional / Conversational / Urgent / Educational / Bold]

---

## Success Metrics

| Metric | Target |
|---|---|
| Impressions | [NUMBER] |
| CTR | [%] |
| Cost per click | $[AMOUNT] |
| Conversions | [NUMBER] |
| Cost per conversion | $[AMOUNT] |
| ROAS | [X:1] |

---

## Assets Provided

- [ ] Logo (PNG, transparent)
- [ ] Brand colours: [HEX CODES]
- [ ] Product / service images
- [ ] Video footage
- [ ] Landing page URL: [URL]

---

**Approved by:** _________________________ Date: _______________`,
  },
];
