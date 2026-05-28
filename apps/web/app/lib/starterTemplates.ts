/**
 * Starter templates seeded for every new user on first visit to the Templates page.
 * These are production-quality documents they can use immediately or adapt.
 */

export interface StarterTemplate {
  name: string;
  department: string;
  content: string;
}

export const STARTER_TEMPLATES: StarterTemplate[] = [
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
| [Service Description] | [1] | $[RATE] | $[AMOUNT] |
| [Service Description] | [1] | $[RATE] | $[AMOUNT] |
| | | | |
| | | **Subtotal** | $[SUBTOTAL] |
| | | Tax ([%]) | $[TAX] |
| | | **Total Due** | **$[TOTAL]** |

---

## Payment Methods

- **Bank Transfer:** [Bank Name] | Account [NUMBER] | Routing [NUMBER]
- **Check:** Payable to [BUSINESS NAME]
- **Online:** [Payment link if applicable]

---

**Late Payment Policy:** Invoices unpaid after 15 days are subject to a 1.5% monthly late fee.

Thank you for your business.`,
  },
  {
    name: "Mutual NDA",
    department: "legal",
    content: `# NON-DISCLOSURE AGREEMENT

**Note:** This is a starting draft. Have a licensed attorney review before using in any binding context.

This Mutual Non-Disclosure Agreement ("Agreement") is entered into as of [DATE] by and between:

**Party A:** [YOUR BUSINESS NAME], a [State] [business type], located at [Address] ("Company A")

**Party B:** [COUNTERPARTY NAME], a [State] [business type], located at [Address] ("Company B")

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

## 7. Remedies

Each Party acknowledges that a breach of this Agreement may cause irreparable harm for which monetary damages may be inadequate, and each Party consents to the other seeking equitable relief in addition to any other remedies available.

## 8. Governing Law

This Agreement shall be governed by the laws of the State of [STATE], without regard to its conflict of law provisions.

## 9. Entire Agreement

This Agreement constitutes the entire agreement between the Parties concerning the subject matter hereof and supersedes all prior discussions, negotiations, and agreements.

---

**IN WITNESS WHEREOF**, the Parties have executed this Agreement as of the date first written above.

**[YOUR BUSINESS NAME]**

Signature: _______________________
Name: [NAME]
Title: [TITLE]
Date: ___________________________

**[COUNTERPARTY NAME]**

Signature: _______________________
Name: [NAME]
Title: [TITLE]
Date: ___________________________`,
  },
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
**Owner:** [Role]
**Time:** [~X minutes]

1. [Action]
2. [Action]
3. [Action]

**Outcome:** [What should exist / be true after this step]

---

### Step 2: [Step Name]
**Owner:** [Role]
**Time:** [~X minutes]

1. [Action]
2. [Action]
3. [Action]

⚠️ **Decision required:** If [condition], do [A]. If [condition], do [B].

**Outcome:** [What should exist / be true after this step]

---

### Step 3: [Step Name]
**Owner:** [Role]
**Time:** [~X minutes]

1. [Action]
2. [Action]
3. [Action]

**Outcome:** [What should exist / be true after this step]

---

## Definition of Done

This process is complete when:
- [ ] [Condition 1]
- [ ] [Condition 2]
- [ ] [Condition 3]

## Exception Handling

| Exception | What to do |
|---|---|
| [Scenario] | [Action] |
| [Scenario] | [Action] |

## Related Documents

- [Link or reference to related SOPs, policies, or resources]

---

*Questions about this SOP? Contact [Owner Name] at [Contact Info].*`,
  },
];
